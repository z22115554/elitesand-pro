cmake_minimum_required(VERSION 3.20)

project(ElitesandSpoutAlphaLab LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "Elitesand Spout Alpha Lab is Windows-only.")
endif()

set(SPOUT_SDK_ROOT "" CACHE PATH "Path to a local clone of the Spout2 SDK")
if(NOT EXISTS "${SPOUT_SDK_ROOT}/CMakeLists.txt")
  message(FATAL_ERROR "Set SPOUT_SDK_ROOT to a local clone of https://github.com/leadedge/Spout2.")
endif()

set(SPOUT_BUILD_LIBRARY OFF CACHE BOOL "" FORCE)
set(SPOUT_BUILD_SPOUTDX ON CACHE BOOL "" FORCE)
set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
add_subdirectory("${SPOUT_SDK_ROOT}" "${CMAKE_BINARY_DIR}/spout-sdk")

add_executable(elitesand-spout-alpha-lab main.cpp)
target_compile_features(elitesand-spout-alpha-lab PRIVATE cxx_std_17)
target_compile_options(elitesand-spout-alpha-lab PRIVATE /utf-8)
# Spout's bundled static libraries use the static MSVC runtime.  Keep the lab
# target aligned so the linker does not mix /MT(d) and /MD(d) CRT objects.
set_property(TARGET elitesand-spout-alpha-lab PROPERTY
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
target_link_libraries(elitesand-spout-alpha-lab PRIVATE SpoutDX_static d2d1 dwrite d3d11 dxgi)
