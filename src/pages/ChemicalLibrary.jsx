import { useState, useEffect } from 'react'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

const CATEGORIES = [
  { value: '', label: 'No category' },
  { value: 'sanitiser', label: 'Sanitiser' },
  { value: 'oxidiser', label: 'Oxidiser / Shock' },
  { value: 'balancer', label: 'Water Balancer' },
  { value: 'algaecide', label: 'Algaecide' },
  { value: 'clarifier', label: 'Clarifier / Flocculant' },
  { value: 'stabiliser', label: 'Stabiliser' },
  { value: 'salt', label: 'Salt' },
  { value: 'other', label: 'Other' },
]

const CATEGORY_COLORS = {
  sanitiser: 'primary',
  oxidiser: 'warning',
  balancer: 'success',
  algaecide: 'salt',
  clarifier: 'mineral',
  stabiliser: 'freshwater',
  salt: 'chlorine',
  other: 'default',
}

const UNIT_OPTIONS = [
  { value: 'L', label: 'Litres (L)' },
  { value: 'mL', label: 'Millilitres (mL)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'tabs', label: 'Tablets' },
  { value: 'bags', label: 'Bags' },
]

const SUGGESTED_CHEMICALS = [
  { name: 'Liquid Chlorine', category: 'sanitiser', default_unit: 'L', suggested_dose: '1-2L per 10,000L', notes: 'Sodium Hypochlorite. Add in the evening for best results.' },
  { name: 'Granular Chlorine', category: 'sanitiser', default_unit: 'g', suggested_dose: '17g per 10,000L (raises 1ppm)', notes: 'Calcium Hypochlorite 65%. Pre-dissolve before adding.' },
  { name: 'Chlorine Tablets', category: 'sanitiser', default_unit: 'tabs', suggested_dose: '1-2 tabs per week per 10,000L', notes: 'Trichlor 200g tablets. Use in a floating dispenser or skimmer.' },
  { name: 'Pool Shock', category: 'oxidiser', default_unit: 'g', suggested_dose: '500g per 50,000L', notes: 'Non-chlorine or calcium hypo shock. Use for breakpoint chlorination.' },
  { name: 'Hydrochloric Acid', category: 'balancer', default_unit: 'mL', suggested_dose: '200mL per 10,000L (lowers pH ~0.2)', notes: 'Lowers pH and alkalinity. Add slowly around pool edges.' },
  { name: 'Sodium Bicarbonate', category: 'balancer', default_unit: 'g', suggested_dose: '500g per 10,000L (raises alk ~10ppm)', notes: 'Buffer / baking soda. Raises alkalinity.' },
  { name: 'Soda Ash', category: 'balancer', default_unit: 'g', suggested_dose: '150g per 10,000L (raises pH ~0.2)', notes: 'Sodium carbonate. Raises pH with less effect on alkalinity.' },
  { name: 'Calcium Chloride', category: 'balancer', default_unit: 'kg', suggested_dose: '1kg per 10,000L (raises ~80ppm)', notes: 'Raises calcium hardness. Pre-dissolve in warm water.' },
  { name: 'Cyanuric Acid', category: 'stabiliser', default_unit: 'g', suggested_dose: '300g per 10,000L (raises ~10ppm)', notes: 'Stabiliser / sunscreen. Protects chlorine from UV. Do not exceed 50ppm.' },
  { name: 'Algaecide', category: 'algaecide', default_unit: 'mL', suggested_dose: '100-200mL per 10,000L', notes: 'Quaternary ammonium or copper-based. Use as preventative weekly.' },
  { name: 'Clarifier', category: 'clarifier', default_unit: 'mL', suggested_dose: '100mL per 10,000L', notes: 'Coagulates fine particles. Run filter for 24 hours after dosing.' },
  { name: 'Pool Salt', category: 'salt', default_unit: 'kg', suggested_dose: '10kg per 10,000L (raises ~1000ppm)', notes: 'For salt chlorinated pools. Target 4000-6000ppm depending on cell.' },
]

const emptyProduct = { name: '', category: '', default_unit: 'L', suggested_dose: '', notes: '' }

export default function ChemicalLibrary() {
  const { business } = useBusiness()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [form, setForm] = useState(emptyProduct)
  const [saving, setSaving] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    if (business?.id) fetchProducts()
  }, [business?.id])

  async function fetchProducts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('chemical_products')
      .select('*')
      .eq('business_id', business.id)
      .order('category', { ascending: true })
      .order('name', { ascending: true })
    if (error) console.error('Error fetching products:', error)
    setProducts(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditingProduct(null)
    setForm(emptyProduct)
    setModalOpen(true)
  }

  function openEdit(product) {
    setEditingProduct(product)
    setForm({
      name: product.name || '',
      category: product.category || '',
      default_unit: product.default_unit || 'L',
      suggested_dose: product.suggested_dose || '',
      notes: product.notes || '',
    })
    setModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingProduct) {
        const { error } = await supabase
          .from('chemical_products')
          .update({
            name: form.name.trim(),
            category: form.category || null,
            default_unit: form.default_unit,
            suggested_dose: form.suggested_dose.trim() || null,
            notes: form.notes.trim() || null,
          })
          .eq('id', editingProduct.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('chemical_products')
          .insert({
            business_id: business.id,
            name: form.name.trim(),
            category: form.category || null,
            default_unit: form.default_unit,
            suggested_dose: form.suggested_dose.trim() || null,
            notes: form.notes.trim() || null,
          })
        if (error) throw error
      }
      setModalOpen(false)
      setForm(emptyProduct)
      fetchProducts()
    } catch (err) {
      console.error('Error saving product:', err)
      alert(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingProduct) return
    if (!confirm('Delete this chemical?')) return
    try {
      await supabase.from('chemical_products').delete().eq('id', editingProduct.id)
      setModalOpen(false)
      fetchProducts()
    } catch (err) {
      console.error('Error deleting:', err)
    }
  }

  async function addSuggested(chem) {
    // Check if already exists
    if (products.some(p => p.name.toLowerCase() === chem.name.toLowerCase())) return
    try {
      await supabase.from('chemical_products').insert({
        business_id: business.id,
        ...chem,
      })
      fetchProducts()
    } catch (err) {
      console.error('Error adding suggested:', err)
    }
  }

  async function addAllSuggested() {
    const existing = products.map(p => p.name.toLowerCase())
    const toAdd = SUGGESTED_CHEMICALS.filter(c => !existing.includes(c.name.toLowerCase()))
    if (toAdd.length === 0) return
    try {
      await supabase.from('chemical_products').insert(
        toAdd.map(c => ({ business_id: business.id, ...c }))
      )
      fetchProducts()
      setShowSuggestions(false)
    } catch (err) {
      console.error('Error adding all:', err)
    }
  }

  // Group by category
  const grouped = products.reduce((acc, p) => {
    const cat = p.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(p)
    return acc
  }, {})

  const categoryLabel = (key) => CATEGORIES.find(c => c.value === key)?.label || 'Other'

  if (loading) {
    return (
      <>
        <Header title="Chemical Library" backTo="/settings" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header
        title="Chemical Library"
        backTo="/settings"
        right={
          <button
            onClick={openAdd}
            className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
          >
            <svg className="w-6 h-6 text-pool-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        }
      />
      <PageWrapper>
        {products.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            }
            title="No chemicals yet"
            description="Add your commonly used chemicals with dosage guidelines"
            action="Add from Suggested List"
            onAction={() => setShowSuggestions(true)}
          />
        ) : (
          <div className="space-y-5">
            {/* Quick actions */}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowSuggestions(!showSuggestions)} className="flex-1 text-xs">
                {showSuggestions ? 'Hide Suggestions' : 'Suggested Chemicals'}
              </Button>
              <Button onClick={openAdd} className="flex-1 text-xs">
                + Add Chemical
              </Button>
            </div>

            {/* Product list grouped by category */}
            {Object.entries(grouped).map(([cat, items]) => (
              <section key={cat}>
                <h3 className="section-title mb-2">{categoryLabel(cat)}</h3>
                <div className="space-y-2">
                  {items.map(p => (
                    <Card key={p.id} onClick={() => openEdit(p)}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                            {p.category && (
                              <Badge variant={CATEGORY_COLORS[p.category] || 'default'} className="shrink-0">
                                {categoryLabel(p.category)}
                              </Badge>
                            )}
                          </div>
                          {p.suggested_dose && (
                            <p className="text-xs text-pool-600 font-medium mt-1">{p.suggested_dose}</p>
                          )}
                          {p.notes && (
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{p.notes}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 shrink-0 mt-0.5">{p.default_unit}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Suggested chemicals panel */}
        {showSuggestions && (
          <div className="mt-5 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="section-title">Suggested Chemicals</h3>
              <button
                onClick={addAllSuggested}
                className="text-xs text-pool-600 font-semibold min-h-tap flex items-center hover:text-pool-700"
              >
                Add all
              </button>
            </div>
            <div className="space-y-2">
              {SUGGESTED_CHEMICALS.map((chem, i) => {
                const alreadyAdded = products.some(p => p.name.toLowerCase() === chem.name.toLowerCase())
                return (
                  <Card key={i} className={cn(alreadyAdded && 'opacity-50')}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-gray-900">{chem.name}</p>
                          <Badge variant={CATEGORY_COLORS[chem.category] || 'default'} className="shrink-0">
                            {categoryLabel(chem.category)}
                          </Badge>
                        </div>
                        <p className="text-xs text-pool-600 font-medium mt-1">{chem.suggested_dose}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{chem.notes}</p>
                      </div>
                      {!alreadyAdded ? (
                        <button
                          onClick={() => addSuggested(chem)}
                          className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-pool-50 transition-colors shrink-0"
                        >
                          <svg className="w-5 h-5 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      ) : (
                        <div className="min-h-tap min-w-tap flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </PageWrapper>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingProduct ? 'Edit Chemical' : 'Add Chemical'}>
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Product Name"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Liquid Chlorine"
            required
          />
          <Select
            label="Category"
            options={CATEGORIES}
            value={form.category}
            onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
          />
          <Select
            label="Default Unit"
            options={UNIT_OPTIONS}
            value={form.default_unit}
            onChange={e => setForm(prev => ({ ...prev, default_unit: e.target.value }))}
          />
          <Input
            label="Suggested Dose"
            value={form.suggested_dose}
            onChange={e => setForm(prev => ({ ...prev, suggested_dose: e.target.value }))}
            placeholder="e.g. 1-2L per 10,000L"
          />
          <TextArea
            label="Notes"
            value={form.notes}
            onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Application notes, safety info..."
          />
          <div className="flex gap-3 pt-2">
            {editingProduct && (
              <Button type="button" variant="danger" onClick={handleDelete} className="px-4">
                Delete
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {editingProduct ? 'Save' : 'Add'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
