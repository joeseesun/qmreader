#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR=$(mktemp -d /tmp/qmreader-reader-tests.XXXXXX)
trap 'rm -rf "$BUILD_DIR"' EXIT

xcrun swiftc \
  "$SCRIPT_DIR/QMReader/ArticleShare.swift" \
  "$SCRIPT_DIR/QMReader/ReaderTypefaceMigration.swift" \
  "$SCRIPT_DIR/Tests/ReaderLogicTests.swift" \
  -o "$BUILD_DIR/ReaderLogicTests"

"$BUILD_DIR/ReaderLogicTests"
