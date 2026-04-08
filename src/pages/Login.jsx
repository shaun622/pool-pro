import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, loading: authLoading, signIn } = useAuth();
  const navigate = useNavigate();

  // If already authenticated, redirect away
  useEffect(() => {
    if (!authLoading && user) {
      if (user.user_metadata?.role === 'customer') {
        navigate('/portal', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      // Don't navigate here — the useEffect above will handle it
      // once onAuthStateChange propagates the user state
    } catch (err) {
      setError(err.message || 'Failed to sign in. Please check your credentials.');
      setLoading(false);
    }
  };

  // Don't render the form if already authenticated
  if (!authLoading && user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pool-50 via-white to-pool-100 px-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Branding */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-brand bg-clip-text text-transparent">PoolPro</h1>
          <p className="text-gray-400 mt-1 text-sm">Pool maintenance made simple</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600 font-medium animate-scale-in">
            {error}
          </div>
        )}

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-elevated p-6 border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
              autoComplete="current-password"
            />

            <Button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px]"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </div>

        {/* Signup link */}
        <p className="text-center text-sm text-gray-400 mt-6">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="text-pool-600 font-semibold hover:text-pool-700 min-h-[44px] inline-flex items-center"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
