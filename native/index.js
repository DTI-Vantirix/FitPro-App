// Expo Router custom entry. Define the global background diagnostic task
// BEFORE the Router runtime initializes, including headless OS launches.
import './src/ingestion/background-scheduler-diagnostic';
import './src/ingestion/background-health-read-diagnostic';
import './src/ingestion/background-sync-pilot';
import 'expo-router/entry';
