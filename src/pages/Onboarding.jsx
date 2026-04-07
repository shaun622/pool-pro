import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusiness } from '../hooks/useBusiness';
import { supabase } from '../lib/supabase';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Header from '../components/layout/Header';
import PageWrapper from '../components/layout/PageWrapper';

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1 fields
  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Step 2 fields
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

  const handleBack = () => {
    setError('');
    setStep(1);
  };

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      let logoUrl = null;

      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('logos')
          .upload(fileName, logoFile);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('logos')
          .getPublicUrl(fileName);

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
    <>
      <Header title="Set Up Your Business" />
      <PageWrapper>
        <div className="max-w-md mx-auto">
          {/* Step indicator */}
          <div className="flex items-center justify-center mb-6">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
                  step === 1
                    ? 'bg-[#0EA5E9] text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                1
              </span>
              <span className="w-8 h-px bg-gray-300" />
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
                  step === 2
                    ? 'bg-[#0EA5E9] text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                2
              </span>
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 mb-6">
            Step {step} of 2
          </p>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Step 1: Business details */}
          {step === 1 && (
            <div className="space-y-4">
              <Input
                label="Business Name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Crystal Clear Pools"
                required
              />

              <Input
                label="ABN"
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

              <Button
                onClick={handleNext}
                className="w-full min-h-[44px]"
              >
                Next
              </Button>
            </div>
          )}

          {/* Step 2: Branding */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Logo upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Logo
                </label>

                {logoPreview && (
                  <div className="mb-3 flex justify-center">
                    <img
                      src={logoPreview}
                      alt="Logo preview"
                      className="w-24 h-24 object-contain rounded-lg border border-gray-200"
                    />
                  </div>
                )}

                <label
                  className="flex items-center justify-center w-full min-h-[44px] px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#0EA5E9] transition-colors"
                >
                  <span className="text-sm text-gray-500">
                    {logoFile ? logoFile.name : 'Tap to upload logo'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Brand colour */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Brand Colour
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={brandColour}
                    onChange={(e) => setBrandColour(e.target.value)}
                    className="w-11 h-11 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <span className="text-sm text-gray-500 font-mono">
                    {brandColour}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleBack}
                  variant="secondary"
                  className="flex-1 min-h-[44px]"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 min-h-[44px]"
                >
                  {loading ? 'Setting up...' : 'Complete Setup'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </PageWrapper>
    </>
  );
}
