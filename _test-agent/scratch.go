package main

import (
"fmt"
"reflect"
"github.com/open-telemetry/opamp-go/protobufs"
)

func main() {
	fmt.Println("Fields of AgentHealth:")
	t := reflect.TypeOf(protobufs.ComponentHealth{})
	for i := 0; i < t.NumField(); i++ {
		fmt.Printf("- %s\n", t.Field(i).Name)
	}
}
