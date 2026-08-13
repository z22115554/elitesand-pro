cmake_minimum_required(VERSION 3.20)

project(ElitesandSpoutOutput LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "Elitesand Spout output is Windows-only.")
endif()

set(SPOUT_SDK_ROOT "" CACHE PATH "Path to a pinned local Spout2 SDK checkout")
set(ELECTRON_INCLUDE_DIR "" CACHE PATH "Electron include/node directory")
set(ELECTRON_NODE_LIB "" CACHE FILEPATH "Electron x64 node.lib")
set(NODE_GYP_ROOT "" CACHE PATH "node-gyp package root (for win_delay_load_hook.cc)")

foreach(required SPOUT_SDK_ROOT ELECTRON_INCLUDE_DIR ELECTRON_NODE_LIB NODE_GYP_ROOT)
  if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
    message(FATAL_ERROR "${required} is required.")
  endif()
endforeach()

if(NOT EXISTS "${SPOUT_SDK_ROOT}/CMakeLists.txt")
  message(FATAL_ERROR "SPOUT_SDK_ROOT is not a Spout2 SDK checkout.")
endif()
if(NOT EXISTS "${ELECTRON_INCLUDE_DIR}/node_api.h")
  message(FATAL_ERROR "ELECTRON_INCLUDE_DIR must contain node_api.h.")
endif()
if(NOT EXISTS "${ELECTRON_NODE_LIB}")
  message(FATAL_ERROR "ELECTRON_NODE_LIB does not exist.")
endif()
if(NOT EXISTS "${NODE_GYP_ROOT}/src/win_delay_load_hook.cc")
  message(FATAL_ERROR "NODE_GYP_ROOT must contain src/win_delay_load_hook.cc.")
endif()

set(SPOUT_BUILD_LIBRARY OFF CACHE BOOL "" FORCE)
set(SPOUT_BUILD_SPOUTDX ON CACHE BOOL "" FORCE)
# Electron and its native modules share the dynamic MSVC runtime.  The SDK
# defaults to a global /MT flag intended for standalone Spout applications;
# keeping that flag would make the addon mix CRT ownership with Electron.
set(SPOUT_BUILD_CMT OFF CACHE BOOL "" FORCE)
set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
add_subdirectory("${SPOUT_SDK_ROOT}" "${CMAKE_BINARY_DIR}/spout-sdk" EXCLUDE_FROM_ALL)

function(configure_electron_addon target source)
  add_library(${target} MODULE
    "${source}"
    "${NODE_GYP_ROOT}/src/win_delay_load_hook.cc"
  )
  target_compile_features(${target} PRIVATE cxx_std_17)
  target_compile_definitions(${target} PRIVATE
    BUILDING_NODE_EXTENSION
    NODE_GYP_MODULE_NAME=${target}
    # Electron's Node import library still records node.exe.  The hook sees
    # that delayed import and returns Electron's process image instead.
    HOST_BINARY=\"node.exe\"
  )
  target_compile_options(${target} PRIVATE /utf-8 /EHsc)
  set_property(TARGET ${target} PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
  target_include_directories(${target} PRIVATE "${ELECTRON_INCLUDE_DIR}")
  target_link_libraries(${target} PRIVATE
    delayimp
    "${ELECTRON_NODE_LIB}"
  )
  target_link_options(${target} PRIVATE /DELAYLOAD:node.exe)
  set_target_properties(${target} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    OUTPUT_NAME "${target}"
  )
endfunction()

configure_electron_addon(elitesand_spout_load_probe src/load-probe.cpp)

# Diagnostic only: CP02 uses this to distinguish Electron's delay-load hook
# from Node-API/ABI problems. It is never a production addon target.
add_library(elitesand_spout_bare_probe MODULE src/load-probe.cpp)
target_compile_features(elitesand_spout_bare_probe PRIVATE cxx_std_17)
target_compile_definitions(elitesand_spout_bare_probe PRIVATE
  BUILDING_NODE_EXTENSION
  NODE_GYP_MODULE_NAME=elitesand_spout_bare_probe
)
target_compile_options(elitesand_spout_bare_probe PRIVATE /utf-8 /EHsc)
set_property(TARGET elitesand_spout_bare_probe PROPERTY
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
target_include_directories(elitesand_spout_bare_probe PRIVATE "${ELECTRON_INCLUDE_DIR}")
target_link_libraries(elitesand_spout_bare_probe PRIVATE "${ELECTRON_NODE_LIB}")
set_target_properties(elitesand_spout_bare_probe PROPERTIES PREFIX "" SUFFIX ".node" OUTPUT_NAME "elitesand_spout_bare_probe")

configure_electron_addon(elitesand_spout_output src/addon.cpp)
target_link_libraries(elitesand_spout_output PRIVATE
  SpoutDX_static
  d3d11
  dxgi
)
