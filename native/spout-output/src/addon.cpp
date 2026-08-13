#include <node_api.h>

#include <d3d11.h>
#include <wrl/client.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "SpoutDX.h"

namespace {

using Microsoft::WRL::ComPtr;

constexpr uint32_t kMinWidth = 640;
constexpr uint32_t kMaxWidth = 3840;
constexpr uint32_t kMinHeight = 360;
constexpr uint32_t kMaxHeight = 2160;
constexpr size_t kMaxSenderNameLength = 64;
constexpr uint32_t kMaxProbePoints = 16;

struct ProbePoint {
  uint32_t x;
  uint32_t y;
};

struct ProbeSample {
  uint32_t x;
  uint32_t y;
  uint8_t r;
  uint8_t g;
  uint8_t b;
  uint8_t a;
};

struct FrameTask {
  HANDLE sourceHandle = nullptr;
  uint64_t sequence = 0;
  std::vector<ProbePoint> probePoints;
};

constexpr size_t kBridgeSlotCount = 3;

enum class BridgeSlotState {
  idle,
  submittingSource,
  awaitingSourceCopy,
  awaitingSpoutSend,
};

struct BridgeSlot {
  ComPtr<ID3D11Texture2D> texture;
  ComPtr<ID3D11Texture2D> sourceTexture;
  ComPtr<ID3D11Query> sourceCopyQuery;
  ComPtr<ID3D11Query> spoutSendQuery;
  uint64_t sequence = 0;
  std::chrono::steady_clock::time_point sourceSubmittedAt{};
  std::chrono::steady_clock::time_point sendSubmittedAt{};
  std::vector<ProbePoint> probePoints;
  BridgeSlotState state = BridgeSlotState::idle;
};

struct SenderState {
  std::mutex mutex;
  std::mutex d3dMutex;
  std::condition_variable workerWake;
  std::condition_variable workerDrained;
  std::deque<FrameTask> pendingFrames;
  std::thread worker;
  bool workerBusy = false;
  bool stopRequested = false;
  std::unique_ptr<spoutDX> sender;
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11Device1> device1;
  ComPtr<ID3D11DeviceContext> context;
  ComPtr<ID3D11Texture2D> bootstrapTexture;
  std::vector<BridgeSlot> bridgeSlots;
  ComPtr<ID3D11Texture2D> probeTexture;
  ComPtr<ID3D11Query> copyCompleteQuery;
  bool running = false;
  std::string senderName;
  uint32_t width = 0;
  uint32_t height = 0;
  uint64_t framesReceived = 0;
  uint64_t framesQueued = 0;
  uint64_t framesSent = 0;
  uint64_t framesDropped = 0;
  uint64_t sourceCopyCompletedSequence = 0;
  uint64_t lastGpuSyncUs = 0;
  uint64_t totalGpuSyncUs = 0;
  uint64_t maxGpuSyncUs = 0;
  uint64_t gpuSyncTimeouts = 0;
  uint64_t lastSourceCopySyncUs = 0;
  uint64_t totalSourceCopySyncUs = 0;
  uint64_t maxSourceCopySyncUs = 0;
  uint64_t sourceCopySyncTimeouts = 0;
  uint64_t maxQueueDepth = 0;
  uint32_t adapterVendorId = 0;
  uint32_t adapterDeviceId = 0;
  uint64_t adapterLuid = 0;
  std::vector<ProbeSample> lastProbeSamples;
};

SenderState g_sender;

napi_value makeString(napi_env env, const char* value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value throwError(napi_env env, const char* code, const char* message) {
  napi_value jsCode;
  napi_value jsMessage;
  napi_value error;
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &jsCode);
  napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &jsMessage);
  napi_create_error(env, jsCode, jsMessage, &error);
  napi_throw(env, error);
  return nullptr;
}

bool getNamedValue(napi_env env, napi_value object, const char* name, napi_value* value) {
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok || !has) return false;
  return napi_get_named_property(env, object, name, value) == napi_ok;
}

bool getUint32(napi_env env, napi_value object, const char* name, uint32_t* value) {
  napi_value property;
  return getNamedValue(env, object, name, &property) && napi_get_value_uint32(env, property, value) == napi_ok;
}

bool getAsciiString(napi_env env, napi_value object, const char* name, std::string* value) {
  napi_value property;
  if (!getNamedValue(env, object, name, &property)) return false;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, property, nullptr, 0, &length) != napi_ok || length == 0 || length > kMaxSenderNameLength) return false;
  std::string output(length + 1, '\0');
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, property, output.data(), length + 1, &copied) != napi_ok) return false;
  output.resize(copied);
  if (!std::all_of(output.begin(), output.end(), [](unsigned char ch) { return ch >= 0x20 && ch <= 0x7e; })) return false;
  *value = output;
  return true;
}

bool getOptionalAdapterPreference(napi_env env, napi_value object, std::string* value) {
  napi_value property;
  if (!getNamedValue(env, object, "adapterPreference", &property)) {
    value->clear();
    return true;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, property, nullptr, 0, &length) != napi_ok || length > 32) return false;
  std::string output(length + 1, '\0');
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, property, output.data(), length + 1, &copied) != napi_ok) return false;
  output.resize(copied);
  if (output != "" && output != "low-power" && output != "high-performance") return false;
  *value = output;
  return true;
}

bool selectAdapter(const std::string& preference, ComPtr<IDXGIAdapter1>* selected) {
  selected->Reset();
  if (preference.empty()) return true;
  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
  SIZE_T selectedMemory = preference == "low-power" ? static_cast<SIZE_T>(-1) : 0;
  bool hasCandidate = false;
  for (UINT index = 0; ; ++index) {
    ComPtr<IDXGIAdapter1> candidate;
    if (factory->EnumAdapters1(index, &candidate) == DXGI_ERROR_NOT_FOUND) break;
    DXGI_ADAPTER_DESC1 description{};
    if (FAILED(candidate->GetDesc1(&description)) || (description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE)) continue;
    const bool isBetter = !hasCandidate || (preference == "low-power"
      ? description.DedicatedVideoMemory < selectedMemory
      : description.DedicatedVideoMemory > selectedMemory);
    if (isBetter) {
      selectedMemory = description.DedicatedVideoMemory;
      *selected = candidate;
      hasCandidate = true;
    }
  }
  return *selected != nullptr;
}

bool getObject(napi_env env, napi_value object, const char* name, napi_value* value) {
  napi_value property;
  napi_valuetype type;
  return getNamedValue(env, object, name, &property)
    && napi_typeof(env, property, &type) == napi_ok
    && type == napi_object
    && (*value = property, true);
}

bool getTextureHandle(napi_env env, napi_value textureInfo, HANDLE* handle) {
  napi_value handleObject;
  napi_value handleBuffer;
  if (getObject(env, textureInfo, "handle", &handleObject)) {
    if (!getNamedValue(env, handleObject, "ntHandle", &handleBuffer)) return false;
  } else if (!getNamedValue(env, textureInfo, "sharedTextureHandle", &handleBuffer)) {
    return false;
  }
  bool isBuffer = false;
  size_t size = 0;
  void* data = nullptr;
  if (napi_is_buffer(env, handleBuffer, &isBuffer) != napi_ok || !isBuffer
      || napi_get_buffer_info(env, handleBuffer, &data, &size) != napi_ok
      || size != sizeof(HANDLE)) return false;
  *handle = *reinterpret_cast<HANDLE*>(data);
  return *handle != nullptr;
}

bool getCodedSize(napi_env env, napi_value textureInfo, uint32_t* width, uint32_t* height) {
  napi_value codedSize;
  return getObject(env, textureInfo, "codedSize", &codedSize)
    && getUint32(env, codedSize, "width", width)
    && getUint32(env, codedSize, "height", height);
}

bool getProbePoints(napi_env env, napi_value textureInfo, std::vector<ProbePoint>* points) {
  napi_value value;
  bool has = false;
  if (napi_has_named_property(env, textureInfo, "probePoints", &has) != napi_ok || !has) return true;
  if (napi_get_named_property(env, textureInfo, "probePoints", &value) != napi_ok) return false;
  bool isArray = false;
  uint32_t length = 0;
  if (napi_is_array(env, value, &isArray) != napi_ok || !isArray
      || napi_get_array_length(env, value, &length) != napi_ok || length > kMaxProbePoints) return false;
  points->clear();
  for (uint32_t index = 0; index < length; ++index) {
    napi_value point;
    napi_valuetype type;
    ProbePoint parsed{};
    if (napi_get_element(env, value, index, &point) != napi_ok
        || napi_typeof(env, point, &type) != napi_ok || type != napi_object
        || !getUint32(env, point, "x", &parsed.x) || !getUint32(env, point, "y", &parsed.y)) return false;
    points->push_back(parsed);
  }
  return true;
}

bool ensureProbeTextureLocked(uint32_t width, uint32_t height) {
  if (g_sender.probeTexture) return true;
  D3D11_TEXTURE2D_DESC probeDesc{};
  probeDesc.Width = width;
  probeDesc.Height = height;
  probeDesc.MipLevels = 1;
  probeDesc.ArraySize = 1;
  probeDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  probeDesc.SampleDesc.Count = 1;
  probeDesc.Usage = D3D11_USAGE_STAGING;
  probeDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  return SUCCEEDED(g_sender.device->CreateTexture2D(&probeDesc, nullptr, &g_sender.probeTexture));
}

bool waitForGpuCopyLocked(ID3D11Query* query, uint64_t* elapsedUs = nullptr) {
  const auto startedAt = std::chrono::steady_clock::now();
  const auto finish = [elapsedUs, startedAt](bool result) {
    if (elapsedUs) {
      *elapsedUs = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - startedAt).count());
    }
    return result;
  };
  if (!g_sender.context || !query) return false;
  for (uint32_t attempt = 0; attempt < 2000; ++attempt) {
    HRESULT result = E_FAIL;
    {
      std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
      result = g_sender.context->GetData(query, nullptr, 0, 0);
    }
    if (result == S_OK) return finish(true);
    if (result != S_FALSE) return finish(false);
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return finish(false);
}

bool captureProbeSamples(const std::vector<ProbePoint>& points, ID3D11Texture2D* source, uint32_t width, uint32_t height, std::vector<ProbeSample>* samples) {
  samples->clear();
  if (points.empty()) return true;
  if (!ensureProbeTextureLocked(width, height)) return false;
  g_sender.context->CopyResource(g_sender.probeTexture.Get(), source);
  g_sender.context->Flush();
  D3D11_MAPPED_SUBRESOURCE mapped{};
  if (FAILED(g_sender.context->Map(g_sender.probeTexture.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return false;
  for (size_t index = 0; index < points.size(); ++index) {
    const ProbePoint point = points[index];
    if (point.x >= width || point.y >= height) {
      g_sender.context->Unmap(g_sender.probeTexture.Get(), 0);
      return false;
    }
    const uint8_t* pixel = static_cast<const uint8_t*>(mapped.pData) + point.y * mapped.RowPitch + point.x * 4;
    samples->push_back({ point.x, point.y, pixel[2], pixel[1], pixel[0], pixel[3] });
  }
  g_sender.context->Unmap(g_sender.probeTexture.Get(), 0);
  return true;
}

napi_value makeProbeSamples(napi_env env, const std::vector<ProbeSample>& samples) {
  napi_value result;
  napi_create_array_with_length(env, samples.size(), &result);
  for (size_t index = 0; index < samples.size(); ++index) {
    const ProbeSample& source = samples[index];
    napi_value sample;
    napi_create_object(env, &sample);
    napi_value x;
    napi_value y;
    napi_value r;
    napi_value g;
    napi_value b;
    napi_value a;
    napi_create_uint32(env, source.x, &x);
    napi_create_uint32(env, source.y, &y);
    napi_create_uint32(env, source.r, &r);
    napi_create_uint32(env, source.g, &g);
    napi_create_uint32(env, source.b, &b);
    napi_create_uint32(env, source.a, &a);
    napi_set_named_property(env, sample, "x", x);
    napi_set_named_property(env, sample, "y", y);
    napi_set_named_property(env, sample, "r", r);
    napi_set_named_property(env, sample, "g", g);
    napi_set_named_property(env, sample, "b", b);
    napi_set_named_property(env, sample, "a", a);
    napi_set_element(env, result, index, sample);
  }
  return result;
}

void sendTransparentFrameLocked() {
  // Some receivers retain the last submitted texture briefly after a sender
  // disappears. Publish a real transparent frame before ReleaseSender so a
  // normal output stop cannot leave old lyrics frozen in the composition.
  if (!g_sender.running || !g_sender.sender || !g_sender.device || !g_sender.context || !g_sender.bootstrapTexture) return;
  {
    std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
    ComPtr<ID3D11RenderTargetView> target;
    if (FAILED(g_sender.device->CreateRenderTargetView(g_sender.bootstrapTexture.Get(), nullptr, &target))) return;
    const float transparent[4] = { 0.f, 0.f, 0.f, 0.f };
    g_sender.context->ClearRenderTargetView(target.Get(), transparent);
    if (!g_sender.sender->SendTexture(g_sender.bootstrapTexture.Get())) return;
    g_sender.context->End(g_sender.copyCompleteQuery.Get());
    g_sender.context->Flush();
  }
  waitForGpuCopyLocked(g_sender.copyCompleteQuery.Get());
}

void resetSenderLocked() {
  // The caller must have joined the worker. All immediate-context work belongs
  // to that worker once it has started.
  if (g_sender.sender) {
    g_sender.sender->CloseDirectX11();
    g_sender.sender.reset();
  }
  g_sender.bootstrapTexture.Reset();
  g_sender.bridgeSlots.clear();
  g_sender.probeTexture.Reset();
  g_sender.copyCompleteQuery.Reset();
  g_sender.context.Reset();
  g_sender.device1.Reset();
  g_sender.device.Reset();
  g_sender.running = false;
  g_sender.senderName.clear();
  g_sender.width = 0;
  g_sender.height = 0;
  g_sender.framesReceived = 0;
  g_sender.framesQueued = 0;
  g_sender.framesSent = 0;
  g_sender.framesDropped = 0;
  g_sender.sourceCopyCompletedSequence = 0;
  g_sender.lastGpuSyncUs = 0;
  g_sender.totalGpuSyncUs = 0;
  g_sender.maxGpuSyncUs = 0;
  g_sender.gpuSyncTimeouts = 0;
  g_sender.lastSourceCopySyncUs = 0;
  g_sender.totalSourceCopySyncUs = 0;
  g_sender.maxSourceCopySyncUs = 0;
  g_sender.sourceCopySyncTimeouts = 0;
  g_sender.maxQueueDepth = 0;
  g_sender.adapterVendorId = 0;
  g_sender.adapterDeviceId = 0;
  g_sender.adapterLuid = 0;
  g_sender.lastProbeSamples.clear();
  g_sender.stopRequested = false;
  g_sender.workerBusy = false;
}

napi_value makeStatusLocked(napi_env env) {
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "state", makeString(env, g_sender.running ? "running" : "idle"));
  napi_set_named_property(env, result, "implementation", makeString(env, "cp07-worker-shared-texture-bridge"));
  napi_value textureBridge;
  napi_get_boolean(env, true, &textureBridge);
  napi_set_named_property(env, result, "textureBridge", textureBridge);
  napi_value width;
  napi_value height;
  napi_create_uint32(env, g_sender.width, &width);
  napi_create_uint32(env, g_sender.height, &height);
  napi_set_named_property(env, result, "width", width);
  napi_set_named_property(env, result, "height", height);
  napi_set_named_property(env, result, "senderName", makeString(env, g_sender.senderName.c_str()));
  napi_value framesReceived;
  napi_value framesQueued;
  napi_value framesSent;
  napi_value framesDropped;
  napi_create_double(env, static_cast<double>(g_sender.framesReceived), &framesReceived);
  napi_create_double(env, static_cast<double>(g_sender.framesQueued), &framesQueued);
  napi_create_double(env, static_cast<double>(g_sender.framesSent), &framesSent);
  napi_create_double(env, static_cast<double>(g_sender.framesDropped), &framesDropped);
  napi_set_named_property(env, result, "framesReceived", framesReceived);
  napi_set_named_property(env, result, "framesQueued", framesQueued);
  napi_set_named_property(env, result, "framesSent", framesSent);
  napi_set_named_property(env, result, "framesDropped", framesDropped);
  napi_value sourceCopyCompletedSequence;
  napi_create_double(env, static_cast<double>(g_sender.sourceCopyCompletedSequence), &sourceCopyCompletedSequence);
  napi_set_named_property(env, result, "sourceCopyCompletedSequence", sourceCopyCompletedSequence);
  napi_value lastGpuSyncMs;
  napi_value avgGpuSyncMs;
  napi_value maxGpuSyncMs;
  napi_value gpuSyncTimeouts;
  napi_create_double(env, static_cast<double>(g_sender.lastGpuSyncUs) / 1000.0, &lastGpuSyncMs);
  napi_create_double(env, g_sender.framesSent
    ? (static_cast<double>(g_sender.totalGpuSyncUs) / static_cast<double>(g_sender.framesSent) / 1000.0)
    : 0.0, &avgGpuSyncMs);
  napi_create_double(env, static_cast<double>(g_sender.maxGpuSyncUs) / 1000.0, &maxGpuSyncMs);
  napi_create_double(env, static_cast<double>(g_sender.gpuSyncTimeouts), &gpuSyncTimeouts);
  napi_set_named_property(env, result, "lastGpuSyncMs", lastGpuSyncMs);
  napi_set_named_property(env, result, "avgGpuSyncMs", avgGpuSyncMs);
  napi_set_named_property(env, result, "maxGpuSyncMs", maxGpuSyncMs);
  napi_set_named_property(env, result, "gpuSyncTimeouts", gpuSyncTimeouts);
  napi_value lastSourceCopySyncMs;
  napi_value avgSourceCopySyncMs;
  napi_value maxSourceCopySyncMs;
  napi_value sourceCopySyncTimeouts;
  napi_create_double(env, static_cast<double>(g_sender.lastSourceCopySyncUs) / 1000.0, &lastSourceCopySyncMs);
  napi_create_double(env, g_sender.framesReceived
    ? (static_cast<double>(g_sender.totalSourceCopySyncUs) / static_cast<double>(g_sender.framesReceived) / 1000.0)
    : 0.0, &avgSourceCopySyncMs);
  napi_create_double(env, static_cast<double>(g_sender.maxSourceCopySyncUs) / 1000.0, &maxSourceCopySyncMs);
  napi_create_double(env, static_cast<double>(g_sender.sourceCopySyncTimeouts), &sourceCopySyncTimeouts);
  napi_set_named_property(env, result, "lastSourceCopySyncMs", lastSourceCopySyncMs);
  napi_set_named_property(env, result, "avgSourceCopySyncMs", avgSourceCopySyncMs);
  napi_set_named_property(env, result, "maxSourceCopySyncMs", maxSourceCopySyncMs);
  napi_set_named_property(env, result, "sourceCopySyncTimeouts", sourceCopySyncTimeouts);
  napi_value queueDepth;
  napi_value maxQueueDepth;
  napi_value workerBusy;
  napi_value inFlightFrames;
  napi_create_uint32(env, static_cast<uint32_t>(g_sender.pendingFrames.size()), &queueDepth);
  napi_create_double(env, static_cast<double>(g_sender.maxQueueDepth), &maxQueueDepth);
  napi_get_boolean(env, g_sender.workerBusy, &workerBusy);
  uint32_t inFlight = 0;
  for (const BridgeSlot& slot : g_sender.bridgeSlots) {
    if (slot.state != BridgeSlotState::idle) ++inFlight;
  }
  napi_create_uint32(env, inFlight, &inFlightFrames);
  napi_set_named_property(env, result, "queueDepth", queueDepth);
  napi_set_named_property(env, result, "maxQueueDepth", maxQueueDepth);
  napi_set_named_property(env, result, "workerBusy", workerBusy);
  napi_set_named_property(env, result, "inFlightFrames", inFlightFrames);
  napi_value adapterVendorId;
  napi_value adapterDeviceId;
  napi_value adapterLuid;
  napi_create_uint32(env, g_sender.adapterVendorId, &adapterVendorId);
  napi_create_uint32(env, g_sender.adapterDeviceId, &adapterDeviceId);
  napi_create_double(env, static_cast<double>(g_sender.adapterLuid), &adapterLuid);
  napi_set_named_property(env, result, "adapterVendorId", adapterVendorId);
  napi_set_named_property(env, result, "adapterDeviceId", adapterDeviceId);
  napi_set_named_property(env, result, "adapterLuid", adapterLuid);
  return result;
}

napi_value makeStatus(napi_env env) {
  std::lock_guard<std::mutex> lock(g_sender.mutex);
  return makeStatusLocked(env);
}

void recordWorkerDrop() {
  std::lock_guard<std::mutex> lock(g_sender.mutex);
  g_sender.framesDropped++;
}

bool hasInFlightSlotsLocked() {
  return std::any_of(g_sender.bridgeSlots.begin(), g_sender.bridgeSlots.end(), [](const BridgeSlot& slot) {
    return slot.state != BridgeSlotState::idle;
  });
}

size_t findIdleSlotLocked() {
  for (size_t index = 0; index < g_sender.bridgeSlots.size(); ++index) {
    if (g_sender.bridgeSlots[index].state == BridgeSlotState::idle) return index;
  }
  return g_sender.bridgeSlots.size();
}

void resetBridgeSlotLocked(BridgeSlot& slot) {
  // Texture/query objects are allocated once at startup and must survive
  // frame reuse. Only release the Electron source reference and per-frame
  // metadata here.
  slot.sourceTexture.Reset();
  slot.sequence = 0;
  slot.sourceSubmittedAt = {};
  slot.sendSubmittedAt = {};
  slot.probePoints.clear();
  slot.state = BridgeSlotState::idle;
}

void releaseSourceSlotLocked(BridgeSlot& slot, bool failed) {
  const uint64_t elapsedUs = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
    std::chrono::steady_clock::now() - slot.sourceSubmittedAt).count());
  slot.sourceTexture.Reset();
  if (slot.sequence > g_sender.sourceCopyCompletedSequence) g_sender.sourceCopyCompletedSequence = slot.sequence;
  if (failed) {
    g_sender.sourceCopySyncTimeouts++;
    g_sender.framesDropped++;
    resetBridgeSlotLocked(slot);
    return;
  }
  g_sender.lastSourceCopySyncUs = elapsedUs;
  g_sender.totalSourceCopySyncUs += elapsedUs;
  if (elapsedUs > g_sender.maxSourceCopySyncUs) g_sender.maxSourceCopySyncUs = elapsedUs;
}

bool submitSourceCopy(FrameTask task, size_t slotIndex) {
  if (!task.sourceHandle || slotIndex >= g_sender.bridgeSlots.size()) return false;
  BridgeSlot& slot = g_sender.bridgeSlots[slotIndex];
  bool failed = false;
  {
    std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
    const HRESULT openResult = g_sender.device1->OpenSharedResource1(task.sourceHandle, IID_PPV_ARGS(&slot.sourceTexture));
    if (FAILED(openResult) || !slot.sourceTexture) {
      failed = true;
    } else {
      D3D11_TEXTURE2D_DESC sourceDesc{};
      slot.sourceTexture->GetDesc(&sourceDesc);
      if (sourceDesc.Width != g_sender.width || sourceDesc.Height != g_sender.height || sourceDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM) {
        failed = true;
      } else {
        g_sender.context->CopyResource(slot.texture.Get(), slot.sourceTexture.Get());
        g_sender.context->End(slot.sourceCopyQuery.Get());
        g_sender.context->Flush();
      }
    }
  }
  CloseHandle(task.sourceHandle);
  if (failed) {
    std::lock_guard<std::mutex> lock(g_sender.mutex);
    slot.sequence = task.sequence;
    slot.sourceSubmittedAt = std::chrono::steady_clock::now();
    releaseSourceSlotLocked(slot, true);
    return false;
  }
  slot.sequence = task.sequence;
  slot.probePoints = std::move(task.probePoints);
  slot.sourceSubmittedAt = std::chrono::steady_clock::now();
  slot.state = BridgeSlotState::awaitingSourceCopy;
  return true;
}

bool pollGpuQuery(ID3D11Query* query, HRESULT* result) {
  std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
  *result = g_sender.context->GetData(query, nullptr, 0, 0);
  return *result == S_OK || *result == S_FALSE;
}

void pumpBridgeSlots() {
  for (BridgeSlot& slot : g_sender.bridgeSlots) {
    if (slot.state == BridgeSlotState::awaitingSourceCopy) {
      HRESULT result = E_FAIL;
      if (!pollGpuQuery(slot.sourceCopyQuery.Get(), &result)) {
        std::lock_guard<std::mutex> lock(g_sender.mutex);
        releaseSourceSlotLocked(slot, true);
        continue;
      }
      if (result != S_OK) continue;
      {
        std::lock_guard<std::mutex> lock(g_sender.mutex);
        releaseSourceSlotLocked(slot, false);
      }
      bool sendFailed = false;
      {
        std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
        if (!g_sender.sender->SendTexture(slot.texture.Get())) sendFailed = true;
        else {
          g_sender.context->End(slot.spoutSendQuery.Get());
          g_sender.context->Flush();
        }
      }
      if (sendFailed) {
        std::lock_guard<std::mutex> lock(g_sender.mutex);
        g_sender.framesDropped++;
        resetBridgeSlotLocked(slot);
      } else {
        slot.sendSubmittedAt = std::chrono::steady_clock::now();
        slot.state = BridgeSlotState::awaitingSpoutSend;
      }
      continue;
    }
    if (slot.state != BridgeSlotState::awaitingSpoutSend) continue;
    HRESULT result = E_FAIL;
    if (!pollGpuQuery(slot.spoutSendQuery.Get(), &result)) {
      std::lock_guard<std::mutex> lock(g_sender.mutex);
      g_sender.gpuSyncTimeouts++;
      g_sender.framesDropped++;
      resetBridgeSlotLocked(slot);
      continue;
    }
    if (result != S_OK) continue;

    std::vector<ProbeSample> samples;
    bool probeFailed = false;
    if (!slot.probePoints.empty()) {
      std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
      probeFailed = !captureProbeSamples(slot.probePoints, slot.texture.Get(), g_sender.width, g_sender.height, &samples);
    }
    const uint64_t elapsedUs = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
      std::chrono::steady_clock::now() - slot.sendSubmittedAt).count());
    std::lock_guard<std::mutex> lock(g_sender.mutex);
    if (probeFailed || samples.size() != slot.probePoints.size()) {
      g_sender.framesDropped++;
    } else {
      g_sender.lastGpuSyncUs = elapsedUs;
      g_sender.totalGpuSyncUs += elapsedUs;
      if (elapsedUs > g_sender.maxGpuSyncUs) g_sender.maxGpuSyncUs = elapsedUs;
      g_sender.framesSent++;
      if (!slot.probePoints.empty()) g_sender.lastProbeSamples = std::move(samples);
    }
    resetBridgeSlotLocked(slot);
  }
}

void workerLoop() {
  for (;;) {
    bool stopping = false;
    bool hasWork = false;
    for (;;) {
      FrameTask task;
      size_t slotIndex = 0;
      {
        std::lock_guard<std::mutex> lock(g_sender.mutex);
        stopping = g_sender.stopRequested;
        if (stopping || g_sender.pendingFrames.empty()) break;
        slotIndex = findIdleSlotLocked();
        if (slotIndex == g_sender.bridgeSlots.size()) break;
        task = std::move(g_sender.pendingFrames.front());
        g_sender.pendingFrames.pop_front();
        g_sender.bridgeSlots[slotIndex].state = BridgeSlotState::submittingSource;
        g_sender.workerBusy = true;
      }
      hasWork = submitSourceCopy(std::move(task), slotIndex) || hasWork;
    }

    pumpBridgeSlots();
    {
      std::lock_guard<std::mutex> lock(g_sender.mutex);
      stopping = g_sender.stopRequested;
      const bool active = hasInFlightSlotsLocked();
      g_sender.workerBusy = active || !g_sender.pendingFrames.empty();
      if (!g_sender.workerBusy) g_sender.workerDrained.notify_all();
      hasWork = hasWork || active;
    }

    if (stopping) {
      // Source textures are still retained by Electron until stop() returns;
      // drain the bounded in-flight set before publishing the transparent end
      // frame and releasing the sender.
      while (true) {
        pumpBridgeSlots();
        bool active = false;
        {
          std::lock_guard<std::mutex> lock(g_sender.mutex);
          active = hasInFlightSlotsLocked();
        }
        if (!active) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
      }
      sendTransparentFrameLocked();
      {
        std::lock_guard<std::mutex> d3dLock(g_sender.d3dMutex);
        if (g_sender.sender) g_sender.sender->ReleaseSender();
      }
      std::lock_guard<std::mutex> lock(g_sender.mutex);
      g_sender.running = false;
      g_sender.workerBusy = false;
      g_sender.workerDrained.notify_all();
      return;
    }

    std::unique_lock<std::mutex> lock(g_sender.mutex);
    if (!hasWork) g_sender.workerWake.wait(lock, [] { return g_sender.stopRequested || !g_sender.pendingFrames.empty(); });
    else g_sender.workerWake.wait_for(lock, std::chrono::milliseconds(1), [] { return g_sender.stopRequested || !g_sender.pendingFrames.empty(); });
  }
}

void stopWorkerAndReset() {
  std::thread worker;
  {
    std::lock_guard<std::mutex> lock(g_sender.mutex);
    if (g_sender.worker.joinable()) {
      g_sender.stopRequested = true;
      while (!g_sender.pendingFrames.empty()) {
        FrameTask dropped = std::move(g_sender.pendingFrames.front());
        g_sender.pendingFrames.pop_front();
        if (dropped.sourceHandle) CloseHandle(dropped.sourceHandle);
        if (dropped.sequence > g_sender.sourceCopyCompletedSequence) g_sender.sourceCopyCompletedSequence = dropped.sequence;
        g_sender.framesDropped++;
      }
      worker = std::move(g_sender.worker);
      g_sender.workerWake.notify_one();
    }
  }
  if (worker.joinable()) worker.join();
  std::lock_guard<std::mutex> lock(g_sender.mutex);
  resetSenderLocked();
}

napi_value createSender(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1) return throwError(env, "INVALID_SPOUT_OPTIONS", "create() requires one options object.");

  napi_valuetype type;
  if (napi_typeof(env, args[0], &type) != napi_ok || type != napi_object) {
    return throwError(env, "INVALID_SPOUT_OPTIONS", "create() options must be an object.");
  }

  std::string senderName;
  std::string adapterPreference;
  uint32_t width = 0;
  uint32_t height = 0;
  if (!getAsciiString(env, args[0], "senderName", &senderName)) {
    return throwError(env, "INVALID_SPOUT_SENDER_NAME", "senderName must be printable ASCII and at most 64 characters.");
  }
  if (!getOptionalAdapterPreference(env, args[0], &adapterPreference)) {
    return throwError(env, "INVALID_SPOUT_ADAPTER_PREFERENCE", "adapterPreference must be low-power, high-performance, or omitted.");
  }
  if (!getUint32(env, args[0], "width", &width) || !getUint32(env, args[0], "height", &height)
      || width < kMinWidth || width > kMaxWidth || height < kMinHeight || height > kMaxHeight) {
    return throwError(env, "INVALID_SPOUT_DIMENSIONS", "width must be 640-3840 and height must be 360-2160.");
  }

  std::lock_guard<std::mutex> lock(g_sender.mutex);
  if (g_sender.running) {
    if (g_sender.senderName == senderName && g_sender.width == width && g_sender.height == height) return makeStatusLocked(env);
    return throwError(env, "SPOUT_ALREADY_RUNNING", "Stop the current sender before changing its settings.");
  }

  g_sender.sender = std::make_unique<spoutDX>();

  const D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
  D3D_FEATURE_LEVEL selectedLevel = D3D_FEATURE_LEVEL_11_0;
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  ComPtr<IDXGIAdapter1> selectedAdapter;
  if (!selectAdapter(adapterPreference, &selectedAdapter)) {
    resetSenderLocked();
    return throwError(env, "D3D11_ADAPTER_SELECT_FAILED", "Could not select the requested D3D11 adapter.");
  }
  const D3D_DRIVER_TYPE driverType = selectedAdapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE;
  HRESULT hr = D3D11CreateDevice(selectedAdapter.Get(), driverType, nullptr,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, featureLevels, ARRAYSIZE(featureLevels), D3D11_SDK_VERSION,
    &device, &selectedLevel, &context);
  if (hr == E_INVALIDARG) {
    const D3D_FEATURE_LEVEL fallbackLevel[] = { D3D_FEATURE_LEVEL_11_0 };
    hr = D3D11CreateDevice(selectedAdapter.Get(), driverType, nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT, fallbackLevel, ARRAYSIZE(fallbackLevel), D3D11_SDK_VERSION,
      &device, &selectedLevel, &context);
  }
  if (FAILED(hr)) {
    resetSenderLocked();
    return throwError(env, "D3D11_DEVICE_CREATE_FAILED", "Could not create a D3D11 device for Spout.");
  }
  ComPtr<ID3D11Device1> device1;
  if (FAILED(device.As(&device1))) {
    resetSenderLocked();
    return throwError(env, "D3D11_1_UNAVAILABLE", "Electron shared textures require an ID3D11Device1-capable device.");
  }
  ComPtr<IDXGIDevice> dxgiDevice;
  ComPtr<IDXGIAdapter> dxgiAdapter;
  DXGI_ADAPTER_DESC adapterDesc{};
  if (SUCCEEDED(device.As(&dxgiDevice)) && SUCCEEDED(dxgiDevice->GetAdapter(&dxgiAdapter))
      && SUCCEEDED(dxgiAdapter->GetDesc(&adapterDesc))) {
    g_sender.adapterVendorId = adapterDesc.VendorId;
    g_sender.adapterDeviceId = adapterDesc.DeviceId;
    g_sender.adapterLuid = (static_cast<uint64_t>(static_cast<uint32_t>(adapterDesc.AdapterLuid.HighPart)) << 32)
      | static_cast<uint32_t>(adapterDesc.AdapterLuid.LowPart);
  }
  D3D11_QUERY_DESC copyCompleteDesc{};
  copyCompleteDesc.Query = D3D11_QUERY_EVENT;
  ComPtr<ID3D11Query> copyCompleteQuery;
  if (FAILED(device->CreateQuery(&copyCompleteDesc, &copyCompleteQuery))) {
    resetSenderLocked();
    return throwError(env, "D3D11_COPY_SYNC_CREATE_FAILED", "Could not create the D3D11 copy-completion query.");
  }

  if (!g_sender.sender->SetSenderName(senderName.c_str())) {
    resetSenderLocked();
    return throwError(env, "SPOUT_SENDER_NAME_FAILED", "Spout rejected the sender name.");
  }
  g_sender.sender->SetSenderFormat(DXGI_FORMAT_B8G8R8A8_UNORM);
  if (!g_sender.sender->OpenDirectX11(device.Get())) {
    resetSenderLocked();
    return throwError(env, "SPOUT_D3D11_OPEN_FAILED", "Spout could not use the D3D11 device.");
  }
  D3D11_TEXTURE2D_DESC textureDesc{};
  textureDesc.Width = width;
  textureDesc.Height = height;
  textureDesc.MipLevels = 1;
  textureDesc.ArraySize = 1;
  textureDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  textureDesc.SampleDesc.Count = 1;
  textureDesc.Usage = D3D11_USAGE_DEFAULT;
  textureDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  ComPtr<ID3D11Texture2D> bootstrapTexture;
  if (FAILED(device->CreateTexture2D(&textureDesc, nullptr, &bootstrapTexture))) {
    resetSenderLocked();
    return throwError(env, "SPOUT_BOOTSTRAP_TEXTURE_FAILED", "Could not create the transparent bootstrap texture.");
  }
  std::vector<BridgeSlot> bridgeSlots(kBridgeSlotCount);
  for (BridgeSlot& slot : bridgeSlots) {
    if (FAILED(device->CreateTexture2D(&textureDesc, nullptr, &slot.texture))
        || FAILED(device->CreateQuery(&copyCompleteDesc, &slot.sourceCopyQuery))
        || FAILED(device->CreateQuery(&copyCompleteDesc, &slot.spoutSendQuery))) {
      resetSenderLocked();
      return throwError(env, "SPOUT_BRIDGE_TEXTURE_CREATE_FAILED", "Could not allocate the D3D11 bridge pipeline textures.");
    }
  }
  ComPtr<ID3D11RenderTargetView> renderTarget;
  if (FAILED(device->CreateRenderTargetView(bootstrapTexture.Get(), nullptr, &renderTarget))) {
    resetSenderLocked();
    return throwError(env, "SPOUT_BOOTSTRAP_TARGET_FAILED", "Could not create the transparent bootstrap render target.");
  }
  const float transparent[4] = { 0.f, 0.f, 0.f, 0.f };
  context->ClearRenderTargetView(renderTarget.Get(), transparent);
  context->Flush();
  if (!g_sender.sender->SendTexture(bootstrapTexture.Get())) {
    resetSenderLocked();
    return throwError(env, "SPOUT_SENDER_CREATE_FAILED", "Spout could not create the sender from the bootstrap texture.");
  }

  g_sender.device = device;
  g_sender.device1 = device1;
  g_sender.context = context;
  g_sender.bootstrapTexture = bootstrapTexture;
  g_sender.bridgeSlots = std::move(bridgeSlots);
  g_sender.copyCompleteQuery = copyCompleteQuery;
  g_sender.running = true;
  g_sender.senderName = senderName;
  g_sender.width = width;
  g_sender.height = height;
  try {
    g_sender.worker = std::thread(workerLoop);
  } catch (...) {
    g_sender.running = false;
    resetSenderLocked();
    return throwError(env, "SPOUT_WORKER_START_FAILED", "Could not start the native Spout frame worker.");
  }
  return makeStatusLocked(env);
}

napi_value sendTexture(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1) return throwError(env, "INVALID_TEXTURE_INFO", "send() requires Electron textureInfo.");
  napi_valuetype type;
  if (napi_typeof(env, args[0], &type) != napi_ok || type != napi_object) {
    return throwError(env, "INVALID_TEXTURE_INFO", "Electron textureInfo must be an object.");
  }

  std::string pixelFormat;
  uint32_t width = 0;
  uint32_t height = 0;
  HANDLE handle = nullptr;
  std::vector<ProbePoint> probePoints;
  if (!getAsciiString(env, args[0], "pixelFormat", &pixelFormat) || pixelFormat != "bgra") {
    return throwError(env, "UNSUPPORTED_TEXTURE_FORMAT", "CP03 currently accepts Electron 8-bit bgra shared textures only.");
  }
  if (!getCodedSize(env, args[0], &width, &height)) {
    return throwError(env, "INVALID_TEXTURE_INFO", "textureInfo.codedSize.width and height are required.");
  }
  if (!getTextureHandle(env, args[0], &handle)) {
    return throwError(env, "INVALID_TEXTURE_HANDLE", "textureInfo.handle.ntHandle must be an 8-byte local NT handle.");
  }
  if (!getProbePoints(env, args[0], &probePoints)) {
    return throwError(env, "INVALID_PROBE_POINTS", "probePoints must contain at most 16 { x, y } entries.");
  }

  uint64_t framesQueued = 0;
  uint64_t sequence = 0;
  uint32_t queueDepth = 0;
  {
    std::lock_guard<std::mutex> lock(g_sender.mutex);
    if (!g_sender.running || !g_sender.device1 || !g_sender.context || !g_sender.sender || g_sender.stopRequested) {
      return throwError(env, "SPOUT_NOT_RUNNING", "Start the Spout sender before sending frames.");
    }
    if (width != g_sender.width || height != g_sender.height) {
      return throwError(env, "SPOUT_TEXTURE_SIZE_MISMATCH", "Electron texture dimensions must match the active Spout sender.");
    }

    size_t inFlight = 0;
    for (const BridgeSlot& slot : g_sender.bridgeSlots) {
      if (slot.state != BridgeSlotState::idle) ++inFlight;
    }
    // Bound all Electron textures retained by the pipeline, not only the
    // native queue: three slots means at most three frames can add latency.
    if (g_sender.pendingFrames.size() + inFlight >= kBridgeSlotCount) {
      g_sender.framesDropped++;
      napi_value result;
      napi_create_object(env, &result);
      napi_value accepted;
      napi_get_boolean(env, true, &accepted);
      napi_set_named_property(env, result, "accepted", accepted);
      napi_set_named_property(env, result, "code", makeString(env, "SPOUT_FRAME_DROPPED"));
      return result;
    }
    HANDLE duplicatedHandle = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), &duplicatedHandle, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
      g_sender.framesDropped++;
      return throwError(env, "SPOUT_SHARED_TEXTURE_DUPLICATE_FAILED", "Could not duplicate Electron's shared texture handle for the native worker.");
    }
    sequence = g_sender.framesQueued + 1;
    g_sender.pendingFrames.push_back({ duplicatedHandle, sequence, std::move(probePoints) });
    g_sender.framesReceived++;
    g_sender.framesQueued = sequence;
    if (g_sender.pendingFrames.size() > g_sender.maxQueueDepth) g_sender.maxQueueDepth = g_sender.pendingFrames.size();
    framesQueued = g_sender.framesQueued;
    queueDepth = static_cast<uint32_t>(g_sender.pendingFrames.size());
  }
  g_sender.workerWake.notify_one();

  napi_value result;
  napi_create_object(env, &result);
  napi_value accepted;
  napi_get_boolean(env, true, &accepted);
  napi_set_named_property(env, result, "accepted", accepted);
  napi_set_named_property(env, result, "code", makeString(env, "SPOUT_FRAME_QUEUED"));
  napi_value queuedValue;
  napi_value depthValue;
  napi_create_double(env, static_cast<double>(framesQueued), &queuedValue);
  napi_create_uint32(env, queueDepth, &depthValue);
  napi_set_named_property(env, result, "framesQueued", queuedValue);
  napi_set_named_property(env, result, "queueDepth", depthValue);
  napi_value sequenceValue;
  napi_create_double(env, static_cast<double>(sequence), &sequenceValue);
  napi_set_named_property(env, result, "sourceSequence", sequenceValue);
  napi_value deferredRelease;
  napi_get_boolean(env, true, &deferredRelease);
  napi_set_named_property(env, result, "deferredRelease", deferredRelease);
  return result;
}

napi_value waitForIdle(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  uint32_t timeoutMs = 5000;
  if (argc == 1 && napi_get_value_uint32(env, args[0], &timeoutMs) != napi_ok) {
    return throwError(env, "INVALID_WAIT_TIMEOUT", "waitForIdle() timeout must be an unsigned millisecond value.");
  }
  if (timeoutMs > 30000) return throwError(env, "INVALID_WAIT_TIMEOUT", "waitForIdle() timeout must be at most 30000 ms.");
  std::unique_lock<std::mutex> lock(g_sender.mutex);
  const bool idle = g_sender.workerDrained.wait_for(lock, std::chrono::milliseconds(timeoutMs), [] {
    return g_sender.pendingFrames.empty() && !g_sender.workerBusy;
  });
  napi_value result;
  napi_get_boolean(env, idle, &result);
  return result;
}

napi_value getLastProbeSamples(napi_env env, napi_callback_info) {
  std::lock_guard<std::mutex> lock(g_sender.mutex);
  return makeProbeSamples(env, g_sender.lastProbeSamples);
}

napi_value stopSender(napi_env env, napi_callback_info) {
  stopWorkerAndReset();
  return makeStatus(env);
}

void cleanup(void*) {
  stopWorkerAndReset();
}

napi_value init(napi_env env, napi_value exports) {
  const napi_property_descriptor methods[] = {
    { "create", nullptr, createSender, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "send", nullptr, sendTexture, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "waitForIdle", nullptr, waitForIdle, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "getLastProbeSamples", nullptr, getLastProbeSamples, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "stop", nullptr, stopSender, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "getStatus", nullptr, [](napi_env callbackEnv, napi_callback_info) { return makeStatus(callbackEnv); }, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, ARRAYSIZE(methods), methods);
  napi_add_env_cleanup_hook(env, cleanup, nullptr);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
