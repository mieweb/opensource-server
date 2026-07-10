import { useNavigate } from 'react-router';
import { ErrorPage } from '@mieweb/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <ErrorPage
      type="404"
      primaryAction={{ label: 'Go to sites', onClick: () => navigate('/sites') }}
    />
  );
}
