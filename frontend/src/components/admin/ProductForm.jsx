import { useState } from 'react';
import Button from '../ui/Button';
import CategorySelect from './CategorySelect';
import { uploadProductImage } from '../../api/products';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EMPTY = {
  sku: '',
  name: '',
  category: '',
  description: '',
  unit_price: '',
  stock_quantity: '',
  availability: 'local',
  lead_time_days: '',
  min_order_qty: '',
  supplier_name: '',
  supplier_location: '',
  supplier_email: '',
  supplier_phone: '',
  supplier_cost: '',
};

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

export default function ProductForm({ initialProduct, onSubmit, onCancel, categories = [], onCreateCategory }) {
  const [form, setForm] = useState(() =>
    initialProduct
      ? {
          sku: initialProduct.sku,
          name: initialProduct.name,
          category: initialProduct.category,
          description: initialProduct.description || '',
          unit_price: initialProduct.unit_price,
          stock_quantity: initialProduct.stock_quantity,
          availability: initialProduct.availability,
          lead_time_days: initialProduct.lead_time_days,
          min_order_qty: initialProduct.min_order_qty,
          supplier_name: initialProduct.supplier_name || '',
          supplier_location: initialProduct.supplier_location || '',
          supplier_email: initialProduct.supplier_email || '',
          supplier_phone: initialProduct.supplier_phone || '',
          supplier_cost: initialProduct.supplier_cost ?? '',
        }
      : EMPTY
  );
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(initialProduct?.image_url || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be smaller than 5MB.');
      return;
    }
    setError('');
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      // Keep the existing image on an edit where no new file was chosen;
      // only upload (and pay for that request) when the user actually picked
      // a new one.
      let imageUrl = initialProduct?.image_url || null;
      if (imageFile) {
        const { data } = await uploadProductImage(imageFile);
        imageUrl = data.url;
      }

      await onSubmit({
        sku: form.sku,
        name: form.name,
        category: form.category,
        description: form.description || null,
        unit_price: Number(form.unit_price),
        stock_quantity: Number(form.stock_quantity),
        availability: form.availability,
        lead_time_days: Number(form.lead_time_days),
        min_order_qty: Number(form.min_order_qty),
        image_url: imageUrl,
        supplier_name: form.supplier_name,
        supplier_location: form.supplier_location,
        supplier_email: form.supplier_email || null,
        supplier_phone: form.supplier_phone,
        supplier_cost: form.supplier_cost === '' ? null : Number(form.supplier_cost),
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this product.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLASS}>SKU</label>
          <input required value={form.sku} onChange={update('sku')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Category</label>
          <CategorySelect
            value={form.category}
            onChange={(category) => setForm((prev) => ({ ...prev, category }))}
            categories={categories}
            onCreateCategory={onCreateCategory}
            className="mt-1"
            selectClassName={FIELD_CLASS.replace('mt-1 ', '')}
            required
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS}>Name</label>
        <input required value={form.name} onChange={update('name')} className={FIELD_CLASS} />
      </div>

      <div>
        <label className={LABEL_CLASS}>Description</label>
        <textarea value={form.description} onChange={update('description')} rows={2} className={FIELD_CLASS} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLASS}>Unit price</label>
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={form.unit_price}
            onChange={update('unit_price')}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>Stock quantity</label>
          <input
            required
            type="number"
            min="0"
            value={form.stock_quantity}
            onChange={update('stock_quantity')}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={LABEL_CLASS}>Availability</label>
          <select value={form.availability} onChange={update('availability')} className={FIELD_CLASS}>
            <option value="local">Local</option>
            <option value="national">National</option>
            <option value="global">Global</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS}>Lead time (days)</label>
          <input
            required
            type="number"
            min="0"
            value={form.lead_time_days}
            onChange={update('lead_time_days')}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>Min order qty</label>
          <input
            required
            type="number"
            min="1"
            value={form.min_order_qty}
            onChange={update('min_order_qty')}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Supplier details</p>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Supplier name</label>
            <input required value={form.supplier_name} onChange={update('supplier_name')} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Supplier location</label>
            <input
              required
              value={form.supplier_location}
              onChange={update('supplier_location')}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Supplier phone</label>
            <input required value={form.supplier_phone} onChange={update('supplier_phone')} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Supplier email (optional)</label>
            <input
              type="email"
              value={form.supplier_email}
              onChange={update('supplier_email')}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Cost price (optional)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.supplier_cost}
              onChange={update('supplier_cost')}
              className={FIELD_CLASS}
              placeholder="What we pay the supplier"
            />
          </div>
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS}>Product image</label>
        {imagePreview && (
          <img
            src={imagePreview}
            alt="Product preview"
            className="mt-2 h-24 w-24 rounded-lg border border-slate-200 object-cover"
          />
        )}
        <input
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-teal-700 hover:file:bg-teal-100"
        />
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {initialProduct ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}
