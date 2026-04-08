import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusiness } from '../hooks/useBusiness';
import { supabase } from '../lib/supabase';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [brandColour, setBrandColour] = useState('#0EA5E9');

  const { createBusiness } = useBusiness();
  const navigate = useNavigate();

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleNext = () => {
    if (!businessName.trim()) {
      setError('Business name is required.');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      let logoUrl = null;
      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, logoFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName);
        logoUrl = urlData.publicUrl;
      }

      await createBusiness({
        name: businessName.trim(),
        abn: abn.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        logo_url: logoUrl,
        brand_colour: brandColour,
      });

      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to create business. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pool-50 via-white to-pool-100">
      <div className="max-w-md mx-auto px-4 pt-12 pb-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set Up Your Business</h1>
          <p className="text-sm text-gray-400 mt-1">Step {step} of 2</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                s === step
                  ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                  : s < step
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-gray-100 text-gray-400'
              }`}>
                {s < step ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : s}
              </div>
              {s < 2 && <div className={`w-12 h-0.5 rounded-full transition-colors ${s < step ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600 font-medium animate-scale-in">
            {error}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-elevated p-6 border border-gray-100 space-y-4 animate-fade-in">
            <Input
              label="Business Name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Crystal Clear Pools"
              required
            />
            <Input
              label="ABN (Optional)"
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              placeholder="e.g. 12 345 678 901"
            />
            <Input
              label="Phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 0412 345 678"
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@yourpoolbiz.com.au"
            />
            <Button onClick={handleNext} className="w-full min-h-[48px]">
              Next
            </Button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="bg-white rounded-2xl shadow-elevated p-6 border border-gray-100 space-y-4 animate-fade-in">
            {/* Logo upload */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Logo</label>
              {logoPreview && (
                <div className="mb-3 flex justify-center">
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="w-20 h-20 object-contain rounded-2xl border border-gray-100 shadow-card"
                  />
                </div>
              )}
              <label className="flex items-center justify-center w-full min-h-[48px] px-4 py-3 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:border-pool-400 hover:bg-pool-50/50 transition-all">
                <span className="text-sm text-gray-400">
                  {logoFile ? logoFile.name : 'Tap to upload logo'}
                </span>
                <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
              </label>
            </div>

            {/* Brand colour */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Brand Colour</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brandColour}
                  onChange={(e) => setBrandColour(e.target.value)}
                  className="w-12 h-12 rounded-xl border-2 border-gray-200 cursor-pointer p-0.5 shadow-inner-soft"
                />
                <span className="text-sm text-gray-400 font-mono">{brandColour}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button onClick={() => setStep(1)} variant="secondary" className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={loading} className="flex-1 min-h-[48px]">
                {loading ? 'Setting up...' : 'Complete Setup'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
