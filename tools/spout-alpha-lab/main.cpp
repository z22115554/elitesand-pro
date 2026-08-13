#include <windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <d3d11.h>
#include <dxgi.h>
#include <wrl/client.h>

#include <chrono>
#include <iostream>
#include <thread>

#include "SpoutDX.h"

using Microsoft::WRL::ComPtr;

namespace {

constexpr UINT kWidth = 1920;
constexpr UINT kHeight = 1080;
constexpr char kSenderName[] = "Elitesand Alpha Lab";

void check(HRESULT value, const char* action) {
  if (FAILED(value)) {
    std::cerr << action << " failed (HRESULT 0x" << std::hex << static_cast<unsigned long>(value) << ").\n";
    std::exit(1);
  }
}

void drawText(ID2D1RenderTarget* target, IDWriteTextFormat* format, ID2D1Brush* brush,
              const wchar_t* text, float x, float y, float width, float height) {
  target->DrawText(text, static_cast<UINT32>(wcslen(text)), format,
                    D2D1::RectF(x, y, x + width, y + height), brush,
                    D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_NATURAL);
}

void drawAlphaTestCard(ID2D1RenderTarget* target, IDWriteFactory* writeFactory) {
  ComPtr<IDWriteTextFormat> title;
  ComPtr<IDWriteTextFormat> body;
  check(writeFactory->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_BOLD,
        DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 96.0f, L"zh-TW", &title),
        "CreateTextFormat(title)");
  check(writeFactory->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_SEMI_BOLD,
        DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 56.0f, L"zh-TW", &body),
        "CreateTextFormat(body)");

  ComPtr<ID2D1SolidColorBrush> white;
  ComPtr<ID2D1SolidColorBrush> blackShadow;
  ComPtr<ID2D1SolidColorBrush> cyan;
  ComPtr<ID2D1SolidColorBrush> magenta;
  ComPtr<ID2D1SolidColorBrush> green;
  check(target->CreateSolidColorBrush(D2D1::ColorF(D2D1::ColorF::White), &white), "CreateBrush(white)");
  check(target->CreateSolidColorBrush(D2D1::ColorF(0.0f, 0.0f, 0.0f, 0.42f), &blackShadow), "CreateBrush(shadow)");
  check(target->CreateSolidColorBrush(D2D1::ColorF(0.05f, 0.95f, 1.0f, 1.0f), &cyan), "CreateBrush(cyan)");
  check(target->CreateSolidColorBrush(D2D1::ColorF(1.0f, 0.15f, 0.72f, 0.50f), &magenta), "CreateBrush(magenta)");
  check(target->CreateSolidColorBrush(D2D1::ColorF(0.0f, 1.0f, 0.25f, 1.0f), &green), "CreateBrush(green)");

  target->BeginDraw();
  target->Clear(D2D1::ColorF(0.0f, 0.0f, 0.0f, 0.0f)); // Transparent black: no matte colour may leak into soft edges.

  drawText(target, title.Get(), blackShadow.Get(), L"Elitesand Alpha Lab", 127.0f, 115.0f, 1700.0f, 160.0f);
  drawText(target, title.Get(), white.Get(), L"Elitesand Alpha Lab", 112.0f, 100.0f, 1700.0f, 160.0f);

  // Repeated low-alpha draws create a deliberately soft glow that exposes alpha mistakes.
  for (int offset = -18; offset <= 18; offset += 6) {
    const float glowAlpha = offset == 0 ? 0.0f : 0.035f;
    ComPtr<ID2D1SolidColorBrush> glow;
    check(target->CreateSolidColorBrush(D2D1::ColorF(0.05f, 0.95f, 1.0f, glowAlpha), &glow), "CreateBrush(glow)");
    drawText(target, title.Get(), glow.Get(), L"SOFT GLOW", 650.0f + offset, 330.0f, 1000.0f, 160.0f);
  }
  drawText(target, title.Get(), cyan.Get(), L"SOFT GLOW", 650.0f, 330.0f, 1000.0f, 160.0f);

  drawText(target, body.Get(), magenta.Get(), L"50% alpha: 淡字 / translucent text", 120.0f, 575.0f, 1600.0f, 90.0f);
  drawText(target, body.Get(), green.Get(), L"GREEN MUST REMAIN VISIBLE", 120.0f, 700.0f, 1600.0f, 90.0f);

  drawText(target, body.Get(), white.Get(), L"No Chroma Key. Background pixels are alpha = 0.", 120.0f, 880.0f, 1700.0f, 80.0f);
  check(target->EndDraw(), "EndDraw");
}

} // namespace

int main() {
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  D3D_FEATURE_LEVEL featureLevel = D3D_FEATURE_LEVEL_11_0;
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  check(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0,
        D3D11_SDK_VERSION, &device, &featureLevel, &context), "D3D11CreateDevice");

  D3D11_TEXTURE2D_DESC textureDesc{};
  textureDesc.Width = kWidth;
  textureDesc.Height = kHeight;
  textureDesc.MipLevels = 1;
  textureDesc.ArraySize = 1;
  textureDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  textureDesc.SampleDesc.Count = 1;
  textureDesc.Usage = D3D11_USAGE_DEFAULT;
  textureDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  ComPtr<ID3D11Texture2D> texture;
  check(device->CreateTexture2D(&textureDesc, nullptr, &texture), "CreateTexture2D");

  ComPtr<IDXGISurface> surface;
  check(texture.As(&surface), "Query IDXGISurface");
  ComPtr<ID2D1Factory> d2dFactory;
  check(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, d2dFactory.GetAddressOf()), "D2D1CreateFactory");
  ComPtr<ID2D1RenderTarget> target;
  const D2D1_RENDER_TARGET_PROPERTIES properties = D2D1::RenderTargetProperties(
    D2D1_RENDER_TARGET_TYPE_DEFAULT,
    D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
  check(d2dFactory->CreateDxgiSurfaceRenderTarget(surface.Get(), &properties, &target),
        "CreateDxgiSurfaceRenderTarget");
  ComPtr<IDWriteFactory> writeFactory;
  check(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
        reinterpret_cast<IUnknown**>(writeFactory.GetAddressOf())), "DWriteCreateFactory");

  drawAlphaTestCard(target.Get(), writeFactory.Get());

  spoutDX sender;
  sender.SetSenderName(kSenderName);
  sender.SetSenderFormat(DXGI_FORMAT_B8G8R8A8_UNORM);
  if (!sender.OpenDirectX11(device.Get())) {
    std::cerr << "Spout DirectX initialization failed.\n";
    return 1;
  }

  std::cout << "Spout sender '" << kSenderName << "' is live at 1920x1080.\n"
            << "In Shoost, add Spout Capture, select this sender, and keep Chroma Key OFF.\n"
            << "Press Ctrl+C in this console to stop.\n";
  while (true) {
    if (!sender.SendTexture(texture.Get())) {
      std::cerr << "Spout SendTexture failed.\n";
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(16));
  }

  sender.ReleaseSender();
  sender.CloseDirectX11();
  return 1;
}
