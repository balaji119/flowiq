import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { HoverablePressable as Pressable } from '../components/HoverablePressable';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setSubmitting(true);
    setError('');

    try {
      await login(email.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Secure Access</Text>
        <Text style={styles.title}>Sign in to ADS CONNECT</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder="you@company.com"
            placeholderTextColor="#6f7e93"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#6f7e93"
          />
        </View>

        <Pressable
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryButtonText}>Sign In</Text>}
        </Pressable>

        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#232733',
    padding: 24,
    gap: 14,
  },
  eyebrow: {
    color: '#8B5CF6',
    textTransform: 'uppercase',
    fontWeight: '800',
    letterSpacing: 1.2,
    fontSize: 12,
  },
  title: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 30,
  },
  subtitle: {
    color: '#888888',
    lineHeight: 22,
  },
  field: {
    gap: 6,
  },
  label: {
    color: '#A0A0A0',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333333',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#1C1F26',
    color: '#F0F0F0',
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.75,
  },
  primaryButtonText: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 16,
  },
  errorText: {
    color: '#FF6B7A',
    fontWeight: '800',
  },
});
