// Controlled embed editor. `value` is an embed object (or null); calls onChange with the updated object.
export default function EmbedBuilder({ value, onChange }) {
  const e = value || {};
  const set = (patch) => onChange({ ...e, ...patch });
  const setAuthor = (patch) => set({ author: { ...(e.author || {}), ...patch } });
  const setFooter = (patch) => set({ footer: { ...(e.footer || {}), ...patch } });

  const fields = Array.isArray(e.fields) ? e.fields : [];
  const setField = (i, patch) => set({ fields: fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const addField = () => set({ fields: [...fields, { name: '', value: '', inline: false }] });
  const removeField = (i) => set({ fields: fields.filter((_, idx) => idx !== i) });

  const colorHex =
    typeof e.color === 'number'
      ? '#' + (e.color & 0xffffff).toString(16).padStart(6, '0')
      : typeof e.color === 'string' && e.color.startsWith('#')
        ? e.color
        : '#9119f5';

  return (
    <div className="embed-builder">
      <div className="row2">
        <label>Color
          <input type="color" value={colorHex}
            onChange={(ev) => set({ color: parseInt(ev.target.value.slice(1), 16) })} />
        </label>
        <label>Title
          <input value={e.title || ''} maxLength={256}
            onChange={(ev) => set({ title: ev.target.value })} placeholder="Embed title" />
        </label>
      </div>

      <label>Title link (URL)
        <input value={e.url || ''} onChange={(ev) => set({ url: ev.target.value })}
          placeholder="https://…" />
      </label>

      <label>Description
        <textarea rows={4} value={e.description || ''} maxLength={4096}
          onChange={(ev) => set({ description: ev.target.value })}
          placeholder="Main body of the embed. Markdown supported." />
      </label>

      <div className="row2">
        <label>Author name
          <input value={e.author?.name || ''} onChange={(ev) => setAuthor({ name: ev.target.value })} />
        </label>
        <label>Author icon URL
          <input value={e.author?.icon_url || ''} onChange={(ev) => setAuthor({ icon_url: ev.target.value })}
            placeholder="https://…" />
        </label>
      </div>

      <div className="row2">
        <label>Thumbnail URL
          <input value={e.thumbnail || ''} onChange={(ev) => set({ thumbnail: ev.target.value })}
            placeholder="https://… (small, top-right)" />
        </label>
        <label>Image URL
          <input value={e.image || ''} onChange={(ev) => set({ image: ev.target.value })}
            placeholder="https://… (large, bottom)" />
        </label>
      </div>

      <div className="row2">
        <label>Footer text
          <input value={e.footer?.text || ''} onChange={(ev) => setFooter({ text: ev.target.value })} />
        </label>
        <label className="checkbox inline">
          <input type="checkbox" checked={!!e.timestamp}
            onChange={(ev) => set({ timestamp: ev.target.checked })} /> Show timestamp
        </label>
      </div>

      <div className="fields-editor">
        <div className="fields-head">
          <span>Fields ({fields.length}/25)</span>
          {fields.length < 25 && <button type="button" className="link" onClick={addField}>+ Add field</button>}
        </div>
        {fields.map((f, i) => (
          <div className="field-row" key={i}>
            <input className="f-name" value={f.name || ''} placeholder="Field name"
              onChange={(ev) => setField(i, { name: ev.target.value })} />
            <input className="f-val" value={f.value || ''} placeholder="Field value"
              onChange={(ev) => setField(i, { value: ev.target.value })} />
            <label className="checkbox inline">
              <input type="checkbox" checked={!!f.inline}
                onChange={(ev) => setField(i, { inline: ev.target.checked })} /> inline
            </label>
            <button type="button" className="link danger" onClick={() => removeField(i)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
