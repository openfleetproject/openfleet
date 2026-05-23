/*
Copyright © 2025 OpenFleet Developers <harpreet798677@gmail.com>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
package cmd

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/openfleetproject/openfleet/config"
	"github.com/openfleetproject/openfleet/server"
	"github.com/openfleetproject/openfleet/utils"
)

var (
	cfg     *config.Config
	cfgFile string
)

// rootCmd represents the base command
var rootCmd = &cobra.Command{
	Use:   "openfleet",
	Short: "OpenFleet is a control plane for OpenTelemetry Collectors",
	Long: `OpenFleet is a centralized server that acts as a control plane
	for managing OpenTelemetry Collectors across environments.

	It provides:
	- Centralized configuration management for collectors
	- Secure remote enrollment and fleet management
	- Pipeline control for logs, metrics, and traces
	- Validation and distribution of collector configurations
	- Operational visibility into collector health and status

	OpenFleet is designed to run as a long-lived service and enables
	teams to manage OpenTelemetry collectors at scale.`,
	// Inside your rootCmd RunE function:
	RunE: func(cmd *cobra.Command, args []string) error {
		// 1. Initialize your custom logger using the constructor we just added
		// log.Default() provides the standard system logger
		appLogger := utils.NewLogger(log.Default())

		// 2. Initialize your server (assuming your server.NewServer takes this logger)
		srv := server.NewServer(cfg, appLogger)

		// 3. Start the server
		if err := srv.Start(); err != nil {
			return err
		}

		appLogger.Debugf(context.Background(), "OpAMP listening on %s:%d", cfg.OpAMP.Host, cfg.OpAMP.Port)

		// Keep the service running
		sigs := make(chan os.Signal, 1)
		signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

		// This line blocks until a signal is received
		<-sigs

		appLogger.Debugf(context.Background(), "Shutting down gracefully...")
		srv.Stop() // Tell your OpAMP server to close connections
		return nil

	},
}

// Execute executes the root command
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	cobra.OnInitialize(initConfig)

	// This enables: openfleet --config alternate.yaml
	rootCmd.PersistentFlags().StringVar(
		&cfgFile,
		"config",
		"",
		"path to config file (default: ./config.yaml)",
	)
}

func initConfig() {
	var err error

	//  Default behavior
	if cfgFile == "" {
		cfgFile = "./config.yaml"
	}

	cfg, err = config.Load(cfgFile)
	if err != nil {
		log.Fatalf("failed to load config from %s: %v", cfgFile, err)
	}
}
