package main

import "runtime"

func runtimeSupportsUnixModes() bool { return runtime.GOOS != "windows" }
