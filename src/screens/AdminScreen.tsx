import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { createTenant, createUser, fetchPrintIqOptionsStatus, fetchTenants, fetchUsers, refreshPrintIqOptionsCache, updateUser } from '../services/adminApi';
import { AuthRole, AuthUser, PrintIqOptionsCacheStatus, TenantRecord } from '../types';

const roles: AuthRole[] = ['super_admin', 'admin', 'user'];

type AdminScreenProps = {
  onBack: () => void;
};

function PickerChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function AdminScreen({ onBack }: AdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId || null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [tenantName, setTenantName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');

  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<AuthRole>('user');
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [optionsStatus, setOptionsStatus] = useState<PrintIqOptionsCacheStatus | null>(null);
  const [refreshingOptions, setRefreshingOptions] = useState(false);

  const canManageTenants = session?.user.role === 'super_admin';
  const availableRoles = useMemo(
    () => (session?.user.role === 'super_admin' ? roles : roles.filter((role) => role !== 'super_admin')),
    [session?.user.role],
  );

  useEffect(() => {
    let active = true;

    async function loadAdminData() {
      try {
        setLoading(true);
        setError('');

        let nextTenants: TenantRecord[] = [];
        if (canManageTenants) {
          const tenantResponse = await fetchTenants();
          nextTenants = tenantResponse.tenants;
          if (active) {
            setTenants(nextTenants);
          }

          const cacheStatus = await fetchPrintIqOptionsStatus();
          if (active) {
            setOptionsStatus(cacheStatus);
          }
        }

        const effectiveTenantId =
          session?.user.role === 'super_admin'
            ? selectedTenantId || undefined
            : session?.user.tenantId || undefined;

        const userResponse = await fetchUsers(effectiveTenantId);
        if (!active) {
          return;
        }

        setUsers(userResponse.users);
        if (session?.user.role === 'super_admin' && !selectedTenantId && nextTenants[0]) {
          setSelectedTenantId(nextTenants[0].id);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load admin data');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadAdminData();

    return () => {
      active = false;
    };
  }, [canManageTenants, selectedTenantId, session?.user.role, session?.user.tenantId]);

  async function handleCreateTenant() {
    setCreatingTenant(true);
    setError('');
    setNotice('');

    try {
      const response = await createTenant({ name: tenantName, slug: tenantSlug || undefined });
      setTenants((current) => [...current, response.tenant]);
      setSelectedTenantId(response.tenant.id);
      setTenantName('');
      setTenantSlug('');
      setNotice(`Tenant ${response.tenant.name} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create tenant');
    } finally {
      setCreatingTenant(false);
    }
  }

  async function handleCreateUser() {
    setCreatingUser(true);
    setError('');
    setNotice('');

    try {
      const response = await createUser({
        name: userName,
        email: userEmail,
        password: userPassword,
        role: userRole,
        tenantId: session?.user.role === 'super_admin' ? selectedTenantId : session?.user.tenantId,
      });
      setUsers((current) => [...current, response.user]);
      setUserName('');
      setUserEmail('');
      setUserPassword('');
      setUserRole('user');
      setNotice(`User ${response.user.name} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create user');
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleToggleUser(user: AuthUser, active: boolean) {
    setError('');
    setNotice('');

    try {
      const response = await updateUser(user.id, { active });
      setUsers((current) => current.map((item) => (item.id === user.id ? response.user : item)));
      setNotice(`${response.user.name} is now ${response.user.active ? 'active' : 'inactive'}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update user');
    }
  }

  async function handleRefreshPrintIqOptions() {
    setRefreshingOptions(true);
    setError('');
    setNotice('');

    try {
      const result = await refreshPrintIqOptionsCache();
      setOptionsStatus({
        stocks: {
          cached: true,
          count: result.stocks.count,
          updatedAt: result.stocks.updatedAt,
        },
        processes: {
          cached: true,
          count: result.processes.count,
          updatedAt: result.processes.updatedAt,
        },
      });
      setNotice(result.message);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh PrintIQ option cache');
    } finally {
      setRefreshingOptions(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.eyebrow}>Admin Workspace</Text>
            <Text style={styles.title}>Tenant and user setup</Text>
            <Text style={styles.subtitle}>Use this once to create tenants and everyday to manage access for admins and users.</Text>
          </View>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>Back to Quote Tool</Text>
          </Pressable>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}
        {!!notice && <Text style={styles.noticeText}>{notice}</Text>}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#5d96bf" size="large" />
          </View>
        ) : (
          <>
            {canManageTenants ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Tenants</Text>
                <Text style={styles.cardSubtitle}>Create a tenant before you add tenant-specific admins and users.</Text>

                <View style={styles.field}>
                  <Text style={styles.label}>Tenant name</Text>
                  <TextInput value={tenantName} onChangeText={setTenantName} style={styles.input} placeholder="Acme Print" placeholderTextColor="#6f7e93" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Slug</Text>
                  <TextInput value={tenantSlug} onChangeText={setTenantSlug} style={styles.input} placeholder="acme-print" placeholderTextColor="#6f7e93" />
                </View>
                <Pressable style={[styles.primaryButton, creatingTenant && styles.buttonDisabled]} onPress={handleCreateTenant} disabled={creatingTenant}>
                  <Text style={styles.primaryButtonText}>{creatingTenant ? 'Creating...' : 'Create Tenant'}</Text>
                </Pressable>

                <View style={styles.chipWrap}>
                  {tenants.map((tenant) => (
                    <PickerChip
                      key={tenant.id}
                      label={tenant.name}
                      active={selectedTenantId === tenant.id}
                      onPress={() => setSelectedTenantId(tenant.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {canManageTenants ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>PrintIQ Option Cache</Text>
                <Text style={styles.cardSubtitle}>
                  Import stock and process options once, then reuse the cached values in the quote screen. Refresh again whenever new options are added in PrintIQ.
                </Text>

                <View style={styles.cacheGrid}>
                  <View style={styles.cacheCard}>
                    <Text style={styles.cacheLabel}>Stocks</Text>
                    <Text style={styles.cacheValue}>{optionsStatus?.stocks.count ?? 0}</Text>
                    <Text style={styles.cacheMeta}>
                      {optionsStatus?.stocks.updatedAt ? `Updated ${new Date(optionsStatus.stocks.updatedAt).toLocaleString()}` : 'Not imported yet'}
                    </Text>
                  </View>
                  <View style={styles.cacheCard}>
                    <Text style={styles.cacheLabel}>Processes</Text>
                    <Text style={styles.cacheValue}>{optionsStatus?.processes.count ?? 0}</Text>
                    <Text style={styles.cacheMeta}>
                      {optionsStatus?.processes.updatedAt ? `Updated ${new Date(optionsStatus.processes.updatedAt).toLocaleString()}` : 'Not imported yet'}
                    </Text>
                  </View>
                </View>

                <Pressable style={[styles.primaryButton, refreshingOptions && styles.buttonDisabled]} onPress={handleRefreshPrintIqOptions} disabled={refreshingOptions}>
                  <Text style={styles.primaryButtonText}>{refreshingOptions ? 'Importing...' : 'Import / Refresh PrintIQ Options'}</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Users</Text>
              <Text style={styles.cardSubtitle}>
                {canManageTenants ? 'Create admins or users for the selected tenant.' : 'Manage users for your tenant.'}
              </Text>

              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput value={userName} onChangeText={setUserName} style={styles.input} placeholder="Jane Doe" placeholderTextColor="#6f7e93" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={userEmail}
                  onChangeText={setUserEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                  placeholder="jane@company.com"
                  placeholderTextColor="#6f7e93"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Temporary password</Text>
                <TextInput value={userPassword} onChangeText={setUserPassword} secureTextEntry style={styles.input} placeholder="Temporary password" placeholderTextColor="#6f7e93" />
              </View>

              <Text style={styles.label}>Role</Text>
              <View style={styles.chipWrap}>
                {availableRoles.map((role) => (
                  <PickerChip
                    key={role}
                    label={role.replace('_', ' ')}
                    active={userRole === role}
                    onPress={() => setUserRole(role)}
                  />
                ))}
              </View>

              <Pressable style={[styles.primaryButton, creatingUser && styles.buttonDisabled]} onPress={handleCreateUser} disabled={creatingUser}>
                <Text style={styles.primaryButtonText}>{creatingUser ? 'Creating...' : 'Create User'}</Text>
              </Pressable>

              <View style={styles.userList}>
                {users.map((user) => (
                  <View key={user.id} style={styles.userCard}>
                    <View style={styles.userMeta}>
                      <Text style={styles.userName}>{user.name}</Text>
                      <Text style={styles.userSubtext}>
                        {user.email} · {user.role.replace('_', ' ')} · {user.tenantName || 'Global'}
                      </Text>
                    </View>
                    <Switch value={user.active} onValueChange={(value) => void handleToggleUser(user, value)} trackColor={{ false: '#c8d1de', true: '#34c3ff' }} />
                  </View>
                ))}
                {users.length === 0 ? <Text style={styles.emptyText}>No users found for this scope yet.</Text> : null}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 16,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1080,
  },
  headerRow: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    justifyContent: 'space-between',
    alignItems: Platform.select({ web: 'center', default: 'flex-start' }),
    gap: 12,
  },
  headerTextWrap: {
    gap: 4,
  },
  eyebrow: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    color: '#888888',
    lineHeight: 22,
  },
  backButton: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#1A1A1A',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 28,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  cardSubtitle: {
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
    backgroundColor: '#1A1A1A',
    color: '#F0F0F0',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#333333',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1A1A1A',
  },
  chipActive: {
    backgroundColor: '#6334D1',
    borderColor: '#6334D1',
  },
  chipText: {
    color: '#A0A0A0',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#6334D1',
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  cacheGrid: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    gap: 12,
  },
  cacheCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#1A1A1A',
    padding: 14,
    gap: 4,
  },
  cacheLabel: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cacheValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
  },
  cacheMeta: {
    color: '#888888',
    lineHeight: 20,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  userList: {
    gap: 10,
  },
  userCard: {
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1A1A1A',
  },
  userMeta: {
    flex: 1,
    gap: 2,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  userSubtext: {
    color: '#888888',
    lineHeight: 20,
    textTransform: 'capitalize',
  },
  loadingWrap: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#FF6B7A',
    fontWeight: '800',
  },
  noticeText: {
    color: '#6EE7B7',
    fontWeight: '800',
  },
  emptyText: {
    color: '#666666',
  },
});
