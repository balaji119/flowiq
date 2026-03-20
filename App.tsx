import { StatusBar } from 'expo-status-bar';
import { QuoteBuilderScreen } from './src/screens/QuoteBuilderScreen';

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <QuoteBuilderScreen />
    </>
  );
}
