package server

import (
	uiassets "github.com/openfleetproject/openfleet/ui"
	"io/fs"
)

// uiFiles is the embedded UI filesystem, rooted at the ui/ directory.
var uiFiles fs.FS = uiassets.Files
