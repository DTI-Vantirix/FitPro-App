// Crash reports go to our own API only; set up before anything else can fail.
import './src/diagnostics/install';
// Expo Router custom entry. Define the global background diagnostic task
// BEFORE the Router runtime initializes, including headless OS launches.
import './src/ingestion/background-scheduler-diagnostic';
import './src/ingestion/background-health-read-diagnostic';
import './src/ingestion/background-sync-pilot';
// The run's location task must exist before the OS relaunches the app to deliver fixes.
import './src/run/device/location';
import 'expo-router/entry';
