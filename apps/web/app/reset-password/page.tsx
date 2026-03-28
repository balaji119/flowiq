import { ResetPasswordScreen } from '../../src/screens/ResetPasswordScreen';

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  return <ResetPasswordScreen token={params.token ?? null} />;
}
