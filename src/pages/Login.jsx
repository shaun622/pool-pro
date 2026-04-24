import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useBusiness } from '../hooks/useBusiness';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, loading: authLoading, signIn } = useAuth();
  const { userRole, loading: bizLoading } = useBusiness();
  const navigate = useNavigate();

  // If already authenticated, redirect based on role
  useEffect(() => {
    if (!authLoading && !bizLoading && user) {
      if (user.user_metadata?.role === 'customer') {
        navigate('/portal', { replace: true });
      } else if (userRole === 'tech') {
        navigate('/tech', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [user, authLoading, bizLoading, userRole, navigate]);

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pool-50 via-white to-pool-100 dark:from-gray-950 dark:via-gray-900 dark:to-pool-950/40 px-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Branding */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-brand bg-clip-text text-transparent">PoolPro</h1>
          <p className="text-gray-400 dark:text-gray-500 mt-1 text-sm">Pool maintenance made simple</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-800/40 px-4 py-3 text-sm text-red-600 dark:text-red-300 font-medium animate-scale-in">
            {error}
          </div>
        )}

        {/* Form */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-elevated p-6 border border-gray-100 dark:border-gray-800">
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

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[34px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>

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
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 mt-6">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="text-pool-600 dark:text-pool-400 font-semibold hover:text-pool-700 min-h-[44px] inline-flex items-center"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
