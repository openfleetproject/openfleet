package ui

import "embed"

// Files holds all static assets (index.html, css/, js/) embedded at
// compile time. The root of the FS is the ui/ directory itself.
//
//go:embed index.html css js
var Files embed.FS
