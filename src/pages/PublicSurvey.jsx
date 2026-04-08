import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { supabase } from '../lib/supabase'

function StarRating({ rating, onRate }) {
  const [hovered, setHovered] = useState(0)

  return (
    <div className="flex items-center justify-center gap-2">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          className="transition-transform hover:scale-110 active:scale-95 focus:outline-none"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onRate(star)}
        >
          <svg
            className={`w-12 h-12 transition-colors ${
              star <= (hovered || rating)
                ? 'text-amber-400 drop-shadow-sm'
                : 'text-gray-200'
            }`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  )
}

const RATING_LABELS = {
  1: 'Poor',
  2: 'Below Average',
  3: 'Average',
  4: 'Good',
  5: 'Excellent',
}

export default function PublicSurvey() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [survey, setSurvey] = useState(null)
  const [business, setBusiness] = useState(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!token) return
    fetchSurvey()
  }, [token])

  async function fetchSurvey() {
    try {
      setLoading(true)
      setError(null)

      const { data: surveyData, error: surveyError } = await supabase
        .from('surveys')
        .select('*')
        .eq('token', token)
        .single()

      if (surveyError || !surveyData) {
        setError('This survey link is invalid or has expired.')
        setLoading(false)
        return
      }

      // Already submitted
      if (surveyData.submitted_at) {
        setSurvey(surveyData)
        setSubmitted(true)
      } else {
        setSurvey(surveyData)
      }

      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', surveyData.business_id)
        .single()

      setBusiness(bizData)
    } catch (err) {
      setError('Something went wrong loading the survey.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (rating === 0) return

    try {
      setSubmitting(true)

      const { error: updateError } = await supabase
        .from('surveys')
        .update({
          rating,
          comment: comment.trim() || null,
          submitted_at: new Date().toISOString(),
        })
        .eq('id', survey.id)

      if (updateError) throw updateError

      setSubmitted(true)
    } catch (err) {
      setError('Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">Loading survey...</p>
        </div>
      </div>
    )
  }

  if (error && !survey) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center py-12">
          <div className="text-4xl mb-4">:(</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Survey Not Found</h2>
          <p className="text-gray-500">{error}</p>
        </Card>
      </div>
    )
  }

  const brandColor = business?.brand_colour || '#2563eb'

  // Thank you screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="w-full py-6 px-4" style={{ backgroundColor: brandColor }}>
          <div className="max-w-2xl mx-auto flex items-center gap-4">
            {business?.logo_url && (
              <img
                src={business.logo_url}
                alt={business.name}
                className="h-12 w-12 rounded-lg object-cover bg-white/20"
              />
            )}
            <div className="text-white">
              <h1 className="text-xl font-bold">{business?.name || 'Pool Service'}</h1>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center py-12">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6 animate-[bounce_0.6s_ease-in-out]">
              <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h2>
            <p className="text-gray-500 mb-4">
              Your feedback helps us improve our service. We truly appreciate you taking the time.
            </p>
            {rating > 0 && (
              <div className="flex items-center justify-center gap-1 mt-4">
                {[1, 2, 3, 4, 5].map(star => (
                  <svg
                    key={star}
                    className={`w-8 h-8 ${star <= (survey?.rating || rating) ? 'text-amber-400' : 'text-gray-200'}`}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
            )}
          </Card>
        </div>

        <footer className="w-full border-t bg-white py-6 px-4 mt-auto">
          <div className="max-w-2xl mx-auto text-center text-sm text-gray-500">
            <p className="font-medium text-gray-700">{business?.name}</p>
            <p className="pt-2 text-xs text-gray-400">Powered by PoolPro</p>
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Branded Header */}
      <header className="w-full py-6 px-4" style={{ backgroundColor: brandColor }}>
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          {business?.logo_url && (
            <img
              src={business.logo_url}
              alt={business.name}
              className="h-12 w-12 rounded-lg object-cover bg-white/20"
            />
          )}
          <div className="text-white">
            <h1 className="text-xl font-bold">{business?.name || 'Pool Service'}</h1>
            <p className="text-sm opacity-80">Service Feedback</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full px-4 py-6 flex-1">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <Card className="mb-4">
            <h2 className="text-lg font-bold text-gray-900 text-center mb-2">
              How was your service?
            </h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              We value your feedback. Please rate your recent pool service experience.
            </p>

            <StarRating rating={rating} onRate={setRating} />

            {rating > 0 && (
              <p className="text-center text-sm font-medium mt-3" style={{ color: brandColor }}>
                {RATING_LABELS[rating]}
              </p>
            )}
          </Card>

          {rating > 0 && (
            <Card className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Any additional comments? (optional)
              </label>
              <textarea
                className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none transition-all"
                rows={4}
                placeholder="Tell us what you liked or how we can improve..."
                value={comment}
                onChange={e => setComment(e.target.value)}
              />
            </Card>
          )}

          {rating > 0 && (
            <Button
              type="submit"
              className="w-full py-4 text-base font-semibold rounded-xl"
              loading={submitting}
              disabled={submitting}
            >
              Submit Feedback
            </Button>
          )}
        </form>
      </div>

      <footer className="w-full border-t bg-white py-6 px-4 mt-auto">
        <div className="max-w-2xl mx-auto text-center text-sm text-gray-500">
          <p className="font-medium text-gray-700">{business?.name}</p>
          {business?.phone && <p>Phone: {business.phone}</p>}
          {business?.email && <p>Email: {business.email}</p>}
          <p className="pt-2 text-xs text-gray-400">Powered by PoolPro</p>
        </div>
      </footer>
    </div>
  )
}
