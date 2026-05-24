package main

import (
	"context"
	"log"
	"os"
	"os/signal"

	"github.com/open-telemetry/opamp-go/client"
	"github.com/open-telemetry/opamp-go/client/types"
	"github.com/open-telemetry/opamp-go/protobufs"
)

// simpleLogger implements types.Logger
type simpleLogger struct {
	logger *log.Logger
}

func (l *simpleLogger) Debugf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Printf(format, v...)
}

func (l *simpleLogger) Errorf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Printf("ERROR: "+format, v...)
}

func main() {
	logger := log.New(os.Stdout, "[TestAgent] ", log.LstdFlags)
	opampLog := &simpleLogger{logger: log.New(os.Stderr, "[OpAMP-Library] ", log.LstdFlags)}

	// Create a 16-byte InstanceUid
	var uid types.InstanceUid
	copy(uid[:], "test-instance-12") // must be exactly 16 bytes, we copy up to 16.

	// 1. Configure our Dummy Agent
	settings := types.StartSettings{
		OpAMPServerURL: "ws://localhost:8080/v1/opamp",
		InstanceUid:    uid,
		Callbacks: types.Callbacks{
			OnConnect: func(ctx context.Context) {
				logger.Println("✅ Successfully connected to the OpAMP Server!")
			},
			OnConnectFailed: func(ctx context.Context, err error) {
				logger.Printf("❌ Failed to connect: %v\n", err)
			},
			OnMessage: func(ctx context.Context, msg *types.MessageData) {
				logger.Println("📩 Received message from server!")
				if msg.AgentIdentification != nil {
					logger.Printf("   -> Agent Identification (New UID): %x\n", msg.AgentIdentification.NewInstanceUid)
				}
				if msg.RemoteConfig != nil {
					logger.Printf("   -> Remote Config offered!\n")
				}
				// Also print the whole struct for debugging!
				logger.Printf("   -> Full Details: %+v\n", msg)
			},
			OnCommand: func(ctx context.Context, command *protobufs.ServerToAgentCommand) error {
				if command.Type == protobufs.CommandType_CommandType_Restart {
					logger.Println("🛑 RECEIVED RESTART COMMAND FROM SERVER!")
					os.Exit(0)
				}
				return nil
			},
		},
	}

	// 2. Initialize the WebSocket client
	opampClient := client.NewWebSocket(opampLog)

	// MUST be called before Start()
	err := opampClient.SetAgentDescription(&protobufs.AgentDescription{
		IdentifyingAttributes: []*protobufs.KeyValue{
			{
				Key: "service.name",
				Value: &protobufs.AnyValue{
					Value: &protobufs.AnyValue_StringValue{StringValue: "OpenFleet-Test-Agent"},
				},
			},
		},
	})
	if err != nil {
		logger.Printf("Warning: Failed to set agent description: %v", err)
	} else {
		logger.Println("📤 Agent Description prepared!")
	}

	// MUST be called before Start()
	// AcceptsCommands is required for the server to forward Command messages
	// (e.g. Restart). Without it the opamp-go server library silently drops them.
	caps := protobufs.AgentCapabilities_AgentCapabilities_AcceptsRestartCommand
	err = opampClient.SetCapabilities(&caps)

	if err != nil {
		logger.Printf("Warning: Failed to set capabilities: %v", err)
	}

	logger.Println("Starting OpAMP test client...")
	err = opampClient.Start(context.Background(), settings)
	if err != nil {
		logger.Fatalf("Failed to start client: %v", err)
	}

	logger.Println("Agent is running. Press Ctrl+C to exit.")

	// 5. Keep running until forcefully stopped (Ctrl+C)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh

	logger.Println("Shutting down client...")
	opampClient.Stop(context.Background())
}
