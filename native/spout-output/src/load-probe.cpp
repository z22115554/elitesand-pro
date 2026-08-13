#include <node_api.h>

napi_value init(napi_env env, napi_value exports) {
  napi_value value;
  napi_create_string_utf8(env, "electron-native-load-probe", NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, exports, "kind", value);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
