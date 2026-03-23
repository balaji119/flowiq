import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AdminScreen } from './src/screens/AdminScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { QuoteBuilderScreen } from './src/screens/QuoteBuilderScreen';

function AppShell() {
  const { loading, session } = useAuth();
  const [view, setView] = useState<'quote' | 'admin'>('quote');

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
        <ActivityIndicator size="large" color="#6334D1" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {session ? (
        view === 'admin' ? (
          <AdminScreen onBack={() => setView('quote')} />
        ) : (
          <QuoteBuilderScreen onOpenAdmin={session.user.role !== 'user' ? () => setView('admin') : undefined} />
        )
      ) : (
        <LoginScreen />
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
