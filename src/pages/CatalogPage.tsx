import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Edit2, Search, Package, X, Settings, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

interface CatalogoItem {
  id: string;
  tenant_id: string;
  tipo_item: string;
  nombre: string;
  precio: number | null;
  detalles: any;
  disponible: boolean;
}

export default function CatalogPage() {
  const { empresaId, userRole, empresaData } = useAuth();
  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todas');

  const isRestaurante = empresaData?.tipo_negocio === 'restaurante';
  const defaultCategory = isRestaurante ? 'Platillo' : 'Producto';
  // Estado local de categorías para evitar mutar el objeto del contexto directamente
  const [localCategorias, setLocalCategorias] = useState<string[]>(empresaData?.categorias_catalogo || []);
  const categorias_catalogo = localCategorias;

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogoItem | null>(null);
  
  // Categorias State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategories, setSavingCategories] = useState(false);

  // Form State
  const [form, setForm] = useState({
    nombre: '',
    tipo_item: defaultCategory,
    precio: '',
    descripcion: '',
    disponible: true
  });
  const [saving, setSaving] = useState(false);

  // Custom Dropdown State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [empresaId]);

  // Fix: Reset active category to 'Todas' when searching so results aren't hidden
  useEffect(() => {
    if (searchQuery.trim() !== '') {
      setActiveCategory('Todas');
    }
  }, [searchQuery]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      let query = supabase.from('catalogos').select('*').order('nombre');

      // Si es admin_empresa, solo vemos los de su tenant.
      if (empresaId) {
        query = query.eq('tenant_id', empresaId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setItems(data || []);
    } catch (error: any) {
      toast.error('Error al cargar el catálogo: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter(item =>
    item.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.tipo_item.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openNewModal = () => {
    setEditingItem(null);
    setForm({ nombre: '', tipo_item: categorias_catalogo[0] || defaultCategory, precio: '', descripcion: '', disponible: true });
    setShowModal(true);
  };

  const openEditModal = (item: CatalogoItem) => {
    setEditingItem(item);
    setForm({
      nombre: item.nombre,
      tipo_item: item.tipo_item || categorias_catalogo[0] || defaultCategory,
      precio: item.precio ? item.precio.toString() : '',
      descripcion: item.detalles?.descripcion || '',
      disponible: item.disponible
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este ítem del catálogo permanentemente?')) return;
    try {
      const { error } = await supabase.from('catalogos').delete().eq('id', id);
      if (error) throw error;
      setItems(prev => prev.filter(i => i.id !== id));
      toast.success('Ítem eliminado');
    } catch (e: any) {
      toast.error('Error al eliminar: ' + e.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaId && userRole !== 'superadmin') {
      toast.error('No tienes una empresa asignada para crear ítems.');
      return;
    }

    if (!empresaId) {
      toast.error('Debes pertenecer a un Tenant para editar el catálogo visualmente.');
      return;
    }

    setSaving(true);
    try {
      const itemData: any = {
        tenant_id: empresaId,
        nombre: form.nombre.trim(),
        tipo_item: form.tipo_item.trim() || defaultCategory,
        precio: form.precio ? parseFloat(form.precio) : null,
        detalles: { descripcion: form.descripcion.trim() },
        disponible: form.disponible
      };

      if (editingItem?.id) {
        itemData.id = editingItem.id;
      }

      // Guardado directo e instantáneo en la base de datos (mucho más rápido y sin depender de IA/embeddings)
      const { error } = await supabase
        .from('catalogos')
        .upsert(itemData);

      if (error) throw error;

      toast.success(editingItem ? (isRestaurante ? 'Platillo actualizado ✅' : 'Producto actualizado ✅') : (isRestaurante ? 'Platillo agregado ✅' : 'Producto agregado ✅'));
      setShowModal(false);
      fetchItems(); // Recargar para obtener los datos frescos
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error al guardar en la base de datos');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !empresaId) return;
    const catName = newCategoryName.trim();
    if (categorias_catalogo.includes(catName)) {
      toast.error('La categoría ya existe');
      return;
    }
    setSavingCategories(true);
    try {
      const newArr = [...categorias_catalogo, catName];
      const { error } = await supabase.from('empresas').update({ categorias_catalogo: newArr }).eq('id', empresaId);
      if (error) throw error;
      // Actualizar estado local en vez de mutar el objeto del contexto
      setLocalCategorias(newArr);
      if (empresaData) empresaData.categorias_catalogo = newArr; // sync secundario para otros consumidores
      setNewCategoryName('');
      toast.success('Categoría agregada');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingCategories(false);
    }
  };

  const handleDeleteCategory = async (catName: string) => {
    if (!empresaId || !confirm(`¿Eliminar la categoría "${catName}"?`)) return;
    setSavingCategories(true);
    try {
      const newArr = categorias_catalogo.filter(c => c !== catName);
      const { error } = await supabase.from('empresas').update({ categorias_catalogo: newArr }).eq('id', empresaId);
      if (error) throw error;
      // Actualizar estado local en vez de mutar el objeto del contexto
      setLocalCategorias(newArr);
      if (empresaData) empresaData.categorias_catalogo = newArr; // sync secundario
      toast.success('Categoría eliminada');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingCategories(false);
    }
  };

  const groupedItems = filteredItems.reduce((acc, item) => {
    let cat = item.tipo_item || 'Sin Categoría';
    
    if (categorias_catalogo.length > 0 && !categorias_catalogo.includes(cat)) {
      cat = 'Otros (Sin clasificar)';
    }

    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, CatalogoItem[]>);

  const sortedCategories = Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Otros (Sin clasificar)') return 1;
    if (b === 'Otros (Sin clasificar)') return -1;

    const aIsOfficial = categorias_catalogo.includes(a);
    const bIsOfficial = categorias_catalogo.includes(b);
    if (aIsOfficial && !bIsOfficial) return -1;
    if (!aIsOfficial && bIsOfficial) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-5 h-full overflow-y-auto p-4 sm:p-6 pb-32 md:pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isRestaurante ? 'Menú y Platillos' : 'Catálogo de Productos'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} {isRestaurante ? (items.length === 1 ? 'platillo registrado' : 'platillos registrados') : (items.length === 1 ? 'ítem registrado' : 'ítems registrados')}
            {empresaData?.nombre_empresa ? ` en ${empresaData.nombre_empresa}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowCategoriesModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition shadow-sm"
          >
            <Settings size={16} /> Categorías
          </button>
          <button
            onClick={openNewModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition shadow-sm"
          >
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm flex flex-col sm:flex-row gap-4 mb-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar por nombre o categoría..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl text-sm transition-all outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400 animate-pulse">Cargando catálogo...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Package size={32} className="text-gray-300" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">Catálogo Vacío</h3>
            <p className="text-sm text-gray-500">Agrega productos o servicios para que el Bot los ofrezca.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Horizontal Tabs para Categorías con Overflow Dropdown */}
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <button
                onClick={() => setActiveCategory('Todas')}
                className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm ${
                  activeCategory === 'Todas' 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Ver Todas
              </button>
              
              {sortedCategories.slice(0, 3).map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm ${
                    activeCategory === cat 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {cat} <span className="opacity-70 text-xs ml-1">({groupedItems[cat].length})</span>
                </button>
              ))}

              {sortedCategories.length > 3 && (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-all shadow-sm flex items-center gap-1.5 border ${
                      sortedCategories.slice(3).includes(activeCategory)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {sortedCategories.slice(3).includes(activeCategory) ? activeCategory : 'Más categorías...'}
                    <ChevronDown size={14} className={`transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute top-full mt-2 right-0 md:left-0 w-48 bg-white border border-gray-100 rounded-2xl shadow-xl z-10 py-2 animate-slide-up origin-top-left">
                      {sortedCategories.slice(3).map(cat => (
                        <button
                          key={cat}
                          onClick={() => {
                            setActiveCategory(cat);
                            setIsDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition hover:bg-blue-50 hover:text-blue-600 flex justify-between items-center ${
                            activeCategory === cat ? 'bg-blue-50/50 text-blue-600' : 'text-gray-700'
                          }`}
                        >
                          {cat} <span className="opacity-50 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">{groupedItems[cat].length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div key={activeCategory} className="space-y-6 animate-fade-in">
              {sortedCategories.length === 0 ? (
                <div className="bg-slate-50 border-2 border-dashed border-gray-200 rounded-[24px] p-12 flex flex-col items-center justify-center text-center mt-8">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                    <Search className="text-gray-300" size={32} />
                  </div>
                  <h3 className="text-gray-900 font-bold text-lg">No hay resultados</h3>
                  <p className="text-gray-500 text-sm mt-1">
                    No se encontraron coincidencias para "{searchQuery}".
                  </p>
                </div>
              ) : (
                sortedCategories
                  .filter(categoria => activeCategory === 'Todas' || activeCategory === categoria)
                  .map(categoria => (
                <div key={categoria} className="bg-white rounded-[20px] border border-gray-100 p-4 sm:p-5 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                  {activeCategory === 'Todas' && (
                    <h3 className="text-lg font-black text-gray-900 mb-4 pl-3 flex items-center gap-2">
                      {categoria} 
                    </h3>
                  )}
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 pl-2">
                    {groupedItems[categoria].map(item => (
                      <div key={item.id} className="group border border-gray-100 hover:border-blue-200 bg-gray-50/50 hover:bg-blue-50/30 rounded-[12px] p-3 transition-all shadow-sm hover:shadow-md flex flex-col justify-between h-full">
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-bold text-gray-900 text-sm leading-tight">{item.nombre}</h4>
                            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEditModal(item)} className="p-1 text-blue-500 hover:bg-blue-100 rounded-md transition" title="Editar"><Edit2 size={13}/></button>
                              <button onClick={() => handleDelete(item.id)} className="p-1 text-red-500 hover:bg-red-100 rounded-md transition" title="Eliminar"><Trash2 size={13}/></button>
                            </div>
                          </div>
                          <p className="text-[11px] text-gray-500 line-clamp-2 mb-2 min-h-[1.75rem]">
                            {item.detalles?.descripcion || 'Sin descripción'}
                          </p>
                        </div>
                        
                        <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
                          <span className="text-sm font-black text-emerald-600">
                            {item.precio ? `$${item.precio.toFixed(2)}` : 'N/A'}
                          </span>
                          
                          {item.disponible ? (
                             <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wider">
                               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Disp
                             </span>
                          ) : (
                             <span className="inline-flex items-center gap-1 text-[9px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-100 uppercase tracking-wider">
                               <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Agotado
                             </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )))}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">{editingItem ? 'Editar Ítem' : 'Nuevo Ítem'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Nombre del Producto / Servicio</label>
                <input
                  required
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Hamburguesa Sencilla"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600 block">Categoría / Tipo</label>
                  </div>
                  {categorias_catalogo.length > 0 ? (
                    <select
                      required
                      value={form.tipo_item}
                      onChange={e => setForm({ ...form, tipo_item: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {!categorias_catalogo.includes(form.tipo_item) && form.tipo_item && (
                         <option value={form.tipo_item}>{form.tipo_item} (Heredada)</option>
                      )}
                      {categorias_catalogo.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      required
                      value={form.tipo_item}
                      onChange={e => setForm({ ...form, tipo_item: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Ej: Platillo, Bebida..."
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Precio (Opcional)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.precio}
                    onChange={e => setForm({ ...form, precio: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ej: 120.50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descripción (Para la IA)</label>
                <textarea
                  value={form.descripcion}
                  onChange={e => setForm({ ...form, descripcion: e.target.value })}
                  rows={4}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Ingredientes, tamaño, características especiales..."
                />
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <input
                  type="checkbox"
                  id="disponible"
                  checked={form.disponible}
                  onChange={e => setForm({ ...form, disponible: e.target.checked })}
                  className="w-4 h-4 accent-emerald-600"
                />
                <label htmlFor="disponible" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Producto Disponible actualmente
                </label>
              </div>

            </form>

            <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-end gap-3 flex-shrink-0">
              <button type="button" onClick={() => setShowModal(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleSubmit} disabled={saving} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-50">
                {saving ? 'Guardando...' : (editingItem ? 'Guardar Cambios' : 'Agregar Ítem')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCategoriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCategoriesModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">Administrar Categorías</h2>
              <button onClick={() => setShowCategoriesModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="p-6">
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                  placeholder="Nueva categoría (ej. Bebidas)"
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddCategory}
                  disabled={savingCategories || !newCategoryName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                >
                  Agregar
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {categorias_catalogo.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No tienes categorías definidas. El catálogo usará texto libre.</p>
                ) : (
                  categorias_catalogo.map(cat => (
                    <div key={cat} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
                      <span className="font-medium text-gray-800 text-sm">{cat}</span>
                      <button
                        onClick={() => handleDeleteCategory(cat)}
                        disabled={savingCategories}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                        title="Eliminar categoría"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
