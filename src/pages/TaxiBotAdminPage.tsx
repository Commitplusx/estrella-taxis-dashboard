import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardCheck,
  Hand,
  Hexagon,
  MapPin,
  MessageSquare,
  MousePointer2,
  Plus,
  RefreshCw,
  Save,
  Scan,
  Search,
  Send,
  Settings2,
  LockKeyhole,
  Trash2,
  X,
} from "lucide-react";
import { type TaxiAdminClient, taxiAdminClient } from "../lib/taxiAdminClient";
import { createTaxiAdminPreview } from "../lib/taxiAdminPreview";
import { loadTaxiCoverage } from "../lib/taxiCoverage";
import { loadCachedTaxiCoverage } from '../lib/taxiCoverageCache';
import publicConfig from '../../deployment/stellar/web-public.json';
import TaxiDriversPanel from '../components/TaxiDriversPanel';
import TaxiNeighborhoodsPanel from '../components/TaxiNeighborhoodsPanel';
import { buildZoneColors, zoneColor } from "../lib/taxiZoneColors";
import { TrackingClientError } from "../lib/trackingClient";
import TaxiCustomerAccessPanel from '../components/TaxiCustomerAccessPanel';
import type {
  AdminCommand,
  AdminContext,
  AdminZone,
  OperationsPage,
  ZonePage,
} from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
import TaxiZoneMap, {
  type MapPoint,
  type MapTool,
} from "../components/TaxiZoneMap";
import TaxiChannelForm from "../components/TaxiChannelForm";
import TaxiQualityPanel from "../components/TaxiQualityPanel";
import TaxiDispatchPanel from '../components/TaxiDispatchPanel';
import "./taxiBotAdmin.css";
const money = (cents: number | null) =>
  cents === null ? "Sin tarifa" : "$" +
    (cents / 100).toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
const emptyZones: ZonePage = {
  zones: [],
  hasMore: false,
  totalCells: 0,
  totalAreas: 0,
};
const initialOperations: OperationsPage = {
  sessions: [],
  trips: [],
  deliveries: [],
};
const deliveryLabels: Record<string, string> = {
  pending: "En cola",
  sending: "Enviando",
  accepted: "Aceptado por WhatsApp",
  delivered: "Entregado",
  read: "Leído",
  failed: "No enviado",
  uncertain: "Envío por comprobar",
};
export default function TaxiBotAdminPage(
  { preview = false, zoneEditor = false }: { preview?: boolean; zoneEditor?: boolean },
) {
  const client: TaxiAdminClient = useMemo(
    () => preview ? createTaxiAdminPreview() : taxiAdminClient,
    [preview],
  );
  const [context, setContext] = useState<AdminContext | null>(null),
    [tenantId, setTenant] = useState(""),
    [waba, setWaba] = useState(""),
    [tab, setTab] = useState<"zones" | "neighborhoods" | "operations" | "quality" | "config" | "access">(
      window.location.hash === '#colonias' ? 'neighborhoods' : window.location.hash === '#autorizados' ? 'access' : window.location.hash === '#configuracion' ? 'config' : "zones",
    );
  const [qualityLocked, setQualityLocked] = useState(false);
  const [zoneReload, setZoneReload] = useState(0);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<AdminCommand | null>(null);
  const [list, setList] = useState<ZonePage>(emptyZones),
    [mapZones, setMapZones] = useState<AdminZone[]>([]),
    [search, setSearch] = useState(""),
    [zoneLoading, setZoneLoading] = useState(false);
  const zoneSource = 'base' as const;
  const [focusCell, setFocusCell] = useState<string | null>(null);
  const [coverageProgress, setCoverageProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [mapScope, setMapScope] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [label, setLabel] = useState(""),
    [price, setPrice] = useState(""),
    [tool, setTool] = useState<MapTool>("select");
  const [origin, setOrigin] = useState<MapPoint | null>(null),
    [destination, setDestination] = useState<MapPoint | null>(null),
    [quote, setQuote] = useState<
      { state: string; cents: number | null } | null
    >(null),
    [quoting, setQuoting] = useState(false);
  const [operations, setOperations] = useState(initialOperations),
    [customer, setCustomer] = useState(""),
    [messageDraft, setMessageDraft] = useState({
      tenantId: "",
      waba: "",
      customer: "",
      text: "",
    }),
    [newChannel, setNewChannel] = useState(false),
    [formVersion, setFormVersion] = useState(0);
  const channel =
    context?.channels.find((c) => c.tenantId === tenantId && c.waba === waba) ??
      null;
  const canConfigure = context?.canConfigure ?? false;
  const baseName = context?.tenants.find((t) => t.id === tenantId)?.name ?? "tu base";
  const currentMapScope = tenantId + "|" + waba + "|" + zoneSource;
  const scopedMapZones = useMemo(() => mapScope === currentMapScope ? mapZones : [], [mapScope, currentMapScope, mapZones]);
  const zoneColors = useMemo(() => buildZoneColors(scopedMapZones), [scopedMapZones]);
  const listGeneration = useRef(0),
    operationsGeneration = useRef(0),
    scopeGeneration = useRef(0),
    quoteGeneration = useRef(0);
  const activeConversation =
    operations.sessions.find((s) => s.customer === customer) ?? null;
  const message = messageDraft.tenantId === tenantId &&
      messageDraft.waba === waba && messageDraft.customer === customer
    ? messageDraft.text
    : "";
  const refreshContext = useCallback(async (signal?: AbortSignal) => {
    const data = await client.context(signal);
    setContext(data);
    return data;
  }, [client]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    refreshContext(abort.signal).then((data) => {
      const requestedBase = new URLSearchParams(window.location.search).get('base');
      if (requestedBase && !data.tenants.some(base => base.id === requestedBase)) throw new Error('Tu cuenta no tiene acceso a esa base.');
      const t = requestedBase ?? data.tenants[0]?.id ?? "";
      setTenant(t);
      setWaba(data.channels.find((c) => c.tenantId === t)?.waba ?? "");
    }).catch((e: unknown) => {
      if (!abort.signal.aborted) {
        setError(
          e instanceof Error ? e.message : "No pudimos cargar el panel.",
        );
      }
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [refreshContext]);
  const loadZones = useCallback(async (after?: string) => {
    if (!channel) return;
    const generation = ++listGeneration.current;
    setZoneLoading(true);
    try {
      const page = await client.zones(channel.tenantId, channel.waba, {
        source: zoneSource,
        search,
        ...(after ? { after } : {}),
      });
      if (generation === listGeneration.current) {
        setList((old) => ({
          ...page,
          zones: after ? [...old.zones, ...page.zones].slice(-500) : page.zones,
        }));
      }
    } catch (e: unknown) {
      if (generation === listGeneration.current) {
        setError(
          e instanceof Error ? e.message : "No pudimos cargar las zonas.",
        );
      }
    } finally {
      if (generation === listGeneration.current) setZoneLoading(false);
    }
  }, [channel?.tenantId, channel?.waba, search, zoneSource, client]);
  useEffect(() => {
    const timer = setTimeout(() => void loadZones(), 250);
    return () => {
      clearTimeout(timer);
      listGeneration.current++;
    };
  }, [loadZones, zoneReload]);
  const loadOperations = useCallback(async (selectedCustomer = customer) => {
    if (!channel) return;
    const generation = ++operationsGeneration.current;
    try {
      const data = await client.operations(
        channel.tenantId,
        channel.waba,
        selectedCustomer || undefined,
      );
      if (generation === operationsGeneration.current) setOperations(data);
    } catch (e: unknown) {
      if (generation === operationsGeneration.current) {
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos cargar las conversaciones.",
        );
      }
    }
  }, [channel?.tenantId, channel?.waba, customer, client]);
  useEffect(() => {
    if (tab !== "operations") return;
    void loadOperations();
    return () => {
      operationsGeneration.current++;
    };
  }, [tab, loadOperations]);
  useEffect(() => {
    scopeGeneration.current++;
    setSelected([]);
    setLabel("");
    setPrice("");
    setMapZones([]);
    setList(emptyZones);
    setOperations(initialOperations);
    setCustomer("");
    setOrigin(null);
    setDestination(null);
    setQuote(null);
    setError("");
  }, [tenantId, waba]);
  useEffect(() => {
    setMapZones([]);
    setList(emptyZones);
    setSelected([]);
    setLabel("");
    setPrice("");
    setFocusCell(null);
  }, [zoneSource]);
  useEffect(() => {
    if (!channel || tab !== 'zones') return;
    const abort = new AbortController();
    const loadedScope = channel.tenantId + "|" + channel.waba + "|" + zoneSource;
    setMapScope("");
    setMapZones([]);
    setCoverageProgress({ loaded: 0, total: 0 });
    const progress = (loaded: number, total: number) => {
      if (!abort.signal.aborted) setCoverageProgress({ loaded, total });
    };
    const coverage = !preview && context?.catalogVersion ? loadCachedTaxiCoverage(client, {
      project: publicConfig.url, actorId: context.actorId, tenantId: channel.tenantId, waba: channel.waba,
      source: zoneSource, version: `${channel.revision}:${context.catalogVersion}`,
    }, abort.signal, progress) : loadTaxiCoverage(client, channel.tenantId, channel.waba, zoneSource, abort.signal, progress);
    void coverage.then((zones) => {
      if (!abort.signal.aborted) {
        setMapZones(zones);
        setMapScope(loadedScope);
      }
    }).catch((e: unknown) => {
      if (!abort.signal.aborted) {
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos cargar el mapa completo. Pulsa Actualizar.",
        );
      }
    }).finally(() => {
      if (!abort.signal.aborted) setCoverageProgress(null);
    });
    return () => abort.abort();
  }, [channel?.tenantId, channel?.waba, channel?.revision, context?.catalogVersion, context?.actorId, preview, zoneSource, client, zoneReload, tab]);
  const apply = async (command: AdminCommand) => {
    if (preview) {
      setNotice(
        "Vista de diseño: aquí no se guardan datos ni se envían mensajes.",
      );
      return;
    }
    setBusy(true);
    setPending(command);
    setError("");
    setNotice("");
    try {
      const result = await client.apply(command);
      setPending(null);
      const zonesChanged = command.action === "upsert_zones" ||
        command.action === "remove_zones";
      if (zonesChanged) {
        setSearch("");
      }
      setNotice(
        result.state === "queued"
          ? "Mensaje en cola. Revisa abajo si WhatsApp lo acepta o entrega."
          : zonesChanged
          ? "Zonas guardadas en el servidor. Las próximas cotizaciones usarán las tarifas de esta base."
          : "Cambios guardados en el servidor.",
      );
      setSelected([]);
      setMessageDraft({ tenantId: "", waba: "", customer: "", text: "" });
      setQuote(null);
      try {
        const data = await refreshContext();
        const savedWaba = command.action === 'rename_channel' && typeof command.payload.newWaba === 'string' ? command.payload.newWaba : command.waba;
        setWaba(savedWaba);
        setTenant(command.tenantId);
        setNewChannel(false);
        setFormVersion((v) => v + 1);
        if (data.channels.some((c) => c.waba === savedWaba)) {
          // React effects reload with the current scope and cleared search, never this async closure.
          setZoneReload((v) => v + 1);
          if (tab === "operations") await loadOperations();
        }
      } catch {
        setError(
          "El cambio sí quedó guardado, pero no pudimos actualizar la vista. Pulsa Actualizar.",
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se confirmó el cambio.");
      if (
        e instanceof TrackingClientError && e.status >= 400 && e.status < 500
      ) setPending(null);
    } finally {
      setBusy(false);
    }
  };
  const write = (
    action: AdminCommand["action"],
    payload: Record<string, unknown>,
    revision = channel?.revision ?? 0,
    number = waba,
  ) => {
    if (!tenantId || busy || pending) return;
    void apply({
      action,
      payload,
      tenantId,
      waba: number,
      revision,
      requestId: crypto.randomUUID(),
    });
  };
  const selectCells = (cells: string[]) => {
    if (cells.length > 400) {
      setError(
        "Selecciona hasta 400 celdas por cambio. Puedes guardar una zona en varias partes.",
      );
      return;
    }
    setSelected(cells);
    setError("");
    setQuote(null);
    if (cells.length === 1) {
      const z = [...scopedMapZones, ...list.zones].find((z) => z.cell === cells[0]);
      if (z) {
        setLabel(z.label);
        setPrice(z.cents === null ? "" : String(z.cents / 100));
      }
    }
  };
  const groups = useMemo(() => {
    const rows = new Map<
      string,
      { label: string; cents: number | null; cells: string[]; source: string }
    >();
    for (const z of list.zones) {
      const key = z.label + "|" + z.cents;
      const existing = rows.get(key);
      if (existing) existing.cells.push(z.cell);
      else {rows.set(key, {
          label: z.label,
          cents: z.cents,
          cells: [z.cell],
          source: z.source,
        });}
    }
    return [...rows.values()];
  }, [list.zones]);
  const zones = scopedMapZones;
  const saveZone = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !selected.length || !label.trim() || !/^\d+(?:\.\d{1,2})?$/.test(price) ||
      Number(price) <= 0 || Number(price) > 100000
    ) {
      setError(
        "Selecciona el área, ponle un nombre y escribe un precio válido con hasta dos decimales.",
      );
      return;
    }
    write("upsert_zones", {
      cells: selected,
      label: label.trim(),
      cents: Math.round(Number(price) * 100),
    });
  };
  const resetSelection = () => {
    setSelected([]);
    setLabel("");
    setPrice("");
  };
  const previewPrice = async () => {
    if (!channel || !origin || !destination) return;
    const generation = scopeGeneration.current,
      request = ++quoteGeneration.current;
    setQuoting(true);
    setError("");
    try {
      const result = await client.quote(
        channel.tenantId,
        channel.waba,
        origin,
        destination,
      );
      if (
        generation === scopeGeneration.current &&
        request === quoteGeneration.current
      ) setQuote(result);
    } catch (e: unknown) {
      if (
        generation === scopeGeneration.current &&
        request === quoteGeneration.current
      ) {
        setError(
          e instanceof Error ? e.message : "No pudimos calcular el precio.",
        );
      }
    } finally {
      if (request === quoteGeneration.current) setQuoting(false);
    }
  };
  const refresh = async () => {
    setError("");
    try {
      await refreshContext();
      setZoneReload((v) => v + 1);
      if (tab === "operations") await loadOperations();
      setFormVersion((v) => v + 1);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "No pudimos actualizar el panel.",
      );
    }
  };
  if (loading) {
    return (
      <div className="taxi-admin">
        <div className="taxi-skeleton" aria-label="Cargando panel" />
        <div className="taxi-skeleton taxi-skeleton-map" />
      </div>
    );
  }
  if (!context) {
    return (
      <div className="taxi-admin">
        <div className="taxi-load-error">
          <AlertCircle size={28} />
          <h1>No pudimos cargar {zoneEditor ? "las zonas y tarifas" : "el panel del bot"}</h1>
          <p>{error}</p>
          <p>
            Revisa tu conexión y vuelve a intentarlo. Si acabas de entrar,
            comprueba que tu cuenta tenga una base asignada.
          </p>
          <button
            className="taxi-primary"
            onClick={() => {
              setLoading(true);
              void refreshContext().then((data) => {
                setTenant(data.tenants[0]?.id ?? "");
                setWaba(data.channels[0]?.waba ?? "");
              }).catch((e: unknown) =>
                setError(
                  e instanceof Error ? e.message : "No pudimos cargarlo.",
                )
              ).finally(() => setLoading(false));
            }}
          >
            <RefreshCw size={17} />Reintentar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="taxi-admin">
      {preview && (
        <p className="taxi-demo">
          Vista local de Pompeyo · Puedes revisar las zonas y los precios.
          Los cambios de esta vista no se guardan.
        </p>
      )}
      <header className="taxi-admin-header">
        <div>
          <h1>{zoneEditor ? "Zonas y tarifas" : "Bot de WhatsApp"}</h1>
          <p>{zoneEditor
            ? "Elige una zona, ajusta el precio y guárdalo para tu base."
            : "Zonas, tarifas y atención de los viajes por WhatsApp."}</p>
        </div>
        <button
          className="taxi-secondary"
          onClick={() => void refresh()}
          disabled={busy || Boolean(pending) || qualityLocked}
        >
          <RefreshCw size={17} />Actualizar
        </button>
      </header>
      <div className="taxi-channel-bar">
        <label>
          Base<select
            value={tenantId}
            disabled={busy || Boolean(pending) || qualityLocked}
            onChange={(e) => {
              setTenant(e.target.value);
              setWaba(
                context.channels.find((c) => c.tenantId === e.target.value)
                  ?.waba ?? "",
              );
              setNewChannel(false);
            }}
          >
            {context.tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label>
          Canal de WhatsApp<select
            value={waba}
            disabled={busy || Boolean(pending) || qualityLocked}
            onChange={(e) => {
              setWaba(e.target.value);
              setNewChannel(false);
            }}
          >
            <option value="">Elige un canal</option>
            {context.channels.filter((c) => c.tenantId === tenantId).map((
              c,
            ) => (
              <option key={c.waba} value={c.waba}>{c.name} · {c.waba}</option>
            ))}
          </select>
        </label>
        <span
          className={"taxi-channel-state " + (channel?.enabled ? "is-on" : "")}
        >
          <i />
          {channel?.enabled ? "Canal activo" : "Canal apagado"}
        </span>
        {canConfigure && (
          <button
            className="taxi-text-button"
            onClick={() => {
              setNewChannel(true);
              setTab("config");
            }}
            disabled={busy || Boolean(pending) || qualityLocked || !tenantId}
          >
            <Plus size={16} />Nuevo canal
          </button>
        )}
      </div>
      <nav className="taxi-tabs" aria-label={zoneEditor ? "Administración de zonas" : "Administración del bot"}>
        {([
          { id: "zones", label: "Zonas y tarifas", icon: Hexagon },
          { id:'neighborhoods',label:'Colonias',icon:MapPin },
          {
            id: "operations",
            label: "Conversaciones",
            icon: MessageSquare,
          },
          { id: "quality", label: "Calidad", icon: ClipboardCheck },
          { id: "access", label: "Autorizados", icon: LockKeyhole },
          { id: "config", label: "Configuración", icon: Settings2 },
        ] as const).filter(({ id }) => !zoneEditor || id === "zones" || id === 'neighborhoods' || id === "config" || id === "access")
          .map(({ id, label: tabLabel, icon: Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
              disabled={busy || Boolean(pending) || qualityLocked}
            >
              <Icon size={18} />
              {tabLabel}
            </button>
          ))}
      </nav>
      {error && (
        <div className="taxi-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Cerrar aviso">
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div className="taxi-notice" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {pending && !busy && (
        <div className="taxi-uncertain">
          <p>
            El resultado del guardado quedó pendiente. Comprobaremos la misma
            solicitud para evitar duplicarla.
          </p>
          <button className="taxi-primary" onClick={() => void apply(pending)}>
            Comprobar guardado
          </button>
        </div>
      )}
      {!tenantId && (
        <div className="taxi-empty">
          <h2>Tu cuenta todavía no tiene una base disponible</h2>
          <p>
            La administración debe asignarte una empresa de taxis antes de
            configurar su bot.
          </p>
        </div>
      )}
      {tenantId && tab === "config" && (
        <>
        {channel && <TaxiDriversPanel key={tenantId + '|' + waba} tenantId={tenantId} waba={waba} canEdit={canConfigure} canManageAccounts={preview || context.canManageAccounts === true} preview={preview} disabled={busy || Boolean(pending)}
          onZones={() => setTab('zones')} onLockChange={setQualityLocked} />}
        <TaxiChannelForm
          key={tenantId + "|" + (newChannel ? "new" : waba) + "|" + formVersion}
          channel={newChannel ? null : channel}
          tenantId={tenantId}
          busy={busy || Boolean(pending) || qualityLocked}
          canEdit={canConfigure}
          runtimeReady={context.runtimeReady}
          onSave={(number, revision, payload) => {
            const rename = channel && number !== channel.waba;
            write(rename ? 'rename_channel' : 'configure', rename ? { ...payload, newWaba: number } : payload, revision, rename ? channel.waba : number);
          }}
        />
        </>
      )}
      {channel && tab === "quality" && (
        <TaxiQualityPanel
          key={tenantId + "|" + waba}
          tenantId={tenantId}
          waba={waba}
          canReview={canConfigure}
          preview={preview}
          onLockChange={setQualityLocked}
        />
      )}
      {tenantId && tab === 'access' && <TaxiCustomerAccessPanel key={tenantId} tenantId={tenantId} canEdit={canConfigure} preview={preview} onLockChange={setQualityLocked}/>}
      {tenantId && tab !== "config" && tab !== 'access' && !channel && (
        <div className="taxi-empty">
          <Hexagon size={34} />
          <h2>Vincula las zonas con una base y su WhatsApp</h2>
          <p>
            Guarda el canal en pausa para preparar la cobertura y los precios.
            Puedes hacerlo antes de activar el bot.
          </p>
          {canConfigure && (
            <button
              className="taxi-primary"
              onClick={() => {
                setNewChannel(true);
                setTab("config");
              }}
            >
              Configurar canal<ArrowRight size={17} />
            </button>
          )}
        </div>
      )}
        {channel && tab === 'neighborhoods' && <TaxiNeighborhoodsPanel key={tenantId+'|'+waba} tenantId={tenantId} waba={waba} canEdit={canConfigure} preview={preview} disabled={busy||Boolean(pending)} onLockChange={setQualityLocked}
          onSaved={()=>{void refreshContext().catch((cause:unknown)=>setError(cause instanceof Error?cause.message:'La localidad se guardó. Actualiza la lista para ver los cambios.'));}}/>}
      {channel && tab === "zones" && (
        <>
          <div className="taxi-section-heading">
            <div>
              <h2>{zoneEditor ? `Cobertura de ${baseName}` : "Zonas y tarifas"}</h2>
              <p>
                Selecciona hexágonos en el mapa o busca una zona por nombre.
                Los cambios sólo se aplican a esta base.
              </p>
            </div>
            <span className="taxi-rule">
              Se cobra la tarifa mayor entre recogida y destino
            </span>
          </div>
          <div className="taxi-catalog-controls">
            <p aria-live="polite">
              {zoneLoading ? "Cargando zonas…" : (
                <>
                  <strong>
                    {list.totalCells.toLocaleString("es-MX")} hexágonos
                  </strong>{" "}
                  · {list.totalAreas.toLocaleString("es-MX")} zonas
                </>
              )}
              <small>
                Estas zonas pertenecen a {baseName}. Puedes editar sus nombres y tarifas directamente.
              </small>
            </p>
          </div>
          <div className="taxi-zones-layout">
            <section
              className="taxi-map-section"
              aria-label="Editor de cobertura"
            >
              <div className="taxi-map-toolbar">
                {([
                  { id: "select", label: "Elegir celdas", icon: MousePointer2 },
                  { id: "area", label: "Marcar área", icon: Scan },
                  { id: "origin", label: "Recogida", icon: MapPin },
                  { id: "destination", label: "Destino", icon: MapPin },
                ] as const).map(({ id, label: toolLabel, icon: Icon }) => (
                  <button
                    key={id}
                    className={tool === id ? "is-active" : ""}
                    aria-pressed={tool === id}
                    onClick={() => setTool(id)}
                    disabled={busy || Boolean(pending) ||
                      (!canConfigure && (id === "select" || id === "area"))}
                  >
                    <Icon size={17} />
                    {toolLabel}
                  </button>
                ))}
              </div>
              {coverageProgress && <p className="taxi-map-loading" role="status">
                {coverageProgress.total
                  ? `Cargando mapa completo: ${coverageProgress.loaded.toLocaleString("es-MX")} de ${coverageProgress.total.toLocaleString("es-MX")} hexágonos…`
                  : "Cargando el mapa completo…"}
              </p>}
              <TaxiZoneMap
                channelKey={channel.tenantId + channel.waba + zoneSource}
                focusCell={focusCell}
                center={{ lat: channel.centerLat, lng: channel.centerLng }}
                zones={zones}
                zoneColors={zoneColors}
                selected={selected}
                tool={tool}
                origin={origin}
                destination={destination}
                onSelect={selectCells}
                onPoint={(p) => {
                  quoteGeneration.current++;
                  setQuoting(false);
                  setQuote(null);
                  if (tool === "origin") {
                    setOrigin(p);
                    setTool("destination");
                  } else setDestination(p);
                }}
                disabled={busy || Boolean(pending)}
              />
              {selected.length > 0 && (
                <a className="taxi-edit-selection" href="#taxi-zone-form">
                  Editar {selected.length}{" "}
                  celdas seleccionadas<ArrowRight size={17} />
                </a>
              )}
              <div className="taxi-quote">
                <div>
                  <h3>Prueba el precio de un viaje</h3>
                  <p>
                    {origin ? "Recogida marcada" : "Marca la recogida"} ·{" "}
                    {destination ? "Destino marcado" : "marca el destino"}
                  </p>
                </div>
                <button
                  className="taxi-secondary"
                  onClick={() => void previewPrice()}
                  disabled={!origin || !destination || quoting ||
                    channel.pricingMode !== "h3_zone_max"}
                >
                  {quoting ? "Consultando…" : "Calcular precio"}
                  <ArrowRight size={17} />
                </button>
                {quote && (
                  <p
                    className={"taxi-quote-result " +
                      (quote.state === "priced" ? "is-priced" : "")}
                  >
                    {quote.state === "priced"
                      ? money(quote.cents) + " MXN"
                      : quote.state === "outside_service_area"
                      ? "Uno de los puntos está fuera de la cobertura."
                      : quote.state === "channel_unavailable"
                      ? "Este canal no usa tarifas H3."
                      : "Falta cobertura o una tarifa válida en alguno de los puntos. La base debe confirmar el precio."}
                  </p>
                )}
              </div>
            </section>
            <aside className="taxi-zone-sidebar">
              <form
                id="taxi-zone-form"
                className="taxi-zone-form"
                onSubmit={saveZone}
              >
                <div className="taxi-inline-heading">
                  <h3>
                    {selected.length ? "Editar zona y precio" : "Elige una zona"}
                  </h3>
                  {selected.length > 0 && (
                    <button
                      type="button"
                      onClick={resetSelection}
                      className="taxi-text-button"
                    >
                      Limpiar<X size={15} />
                    </button>
                  )}
                </div>
                <p>
                  {selected.length
                    ? selected.length +
                      " celdas seleccionadas. Se guardarán con este nombre y precio."
                    : "Elige celdas o marca un área en el mapa."}
                </p>
                <label>
                  Nombre de la zona<input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Por ejemplo: Centro"
                    maxLength={100}
                    disabled={!canConfigure || busy || Boolean(pending)}
                    required
                  />
                </label>
                <label>
                  Precio de la zona, MXN<div className="taxi-price-input">
                    <span>$</span>
                    <input
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      disabled={!canConfigure || busy || Boolean(pending)}
                      required
                    />
                  </div>
                </label>
                <button
                  className="taxi-primary"
                  type="submit"
                  disabled={!canConfigure || !selected.length || busy ||
                    Boolean(pending)}
                >
                  <Save size={17} />
                  {busy ? "Guardando…" : "Guardar zona y precio"}
                </button>
                <small>El precio guardado se usará en los próximos viajes de esta base.</small>
                {selected.some((cell) =>
                  zones.some((z) => z.cell === cell && z.assigned)
                ) && canConfigure && (
                  <button
                    type="button"
                    className="taxi-remove"
                    disabled={busy || Boolean(pending)}
                    onClick={() => {
                      if (
                        window.confirm(
                          "¿Quitar estas celdas de la cobertura de esta base? Esos puntos dejarán de tener tarifa.",
                        )
                      ) write("remove_zones", { cells: selected });
                    }}
                  >
                    <Trash2 size={16} />Quitar selección de la cobertura
                  </button>
                )}
              </form>
              <section className="taxi-zone-list">
                <div className="taxi-inline-heading">
                  <h3>
                    Zonas de {baseName}
                  </h3>
                  {zoneLoading && <span>Cargando…</span>}
                </div>
                <label className="taxi-search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar zona"
                    placeholder="Buscar por nombre"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {!groups.length && !zoneLoading && (
                  <p className="taxi-empty-inline">
                    {search
                      ? "No encontramos una zona con ese nombre."
                      : "Todavía no hay zonas registradas. Puedes marcar un área en el mapa."}
                  </p>
                )}
                <div className="taxi-zone-rows">
                  {groups.map((g) => (
                    <button
                      key={g.label + "|" + g.cents}
                      className="taxi-zone-row"
                      disabled={!canConfigure || busy || Boolean(pending) ||
                        g.cells.length > 400}
                      onClick={() => {
                        selectCells(g.cells);
                        setFocusCell(g.cells[0]);
                        setLabel(g.label);
                        setPrice(g.cents === null ? "" : String(g.cents / 100));
                        setTool("select");
                      }}
                    >
                      <span>
                        <span className="taxi-zone-name">
                          <i className="taxi-zone-swatch" style={{ backgroundColor: zoneColor(g.label, zoneColors) }} aria-hidden="true" />
                          <strong>{g.label}</strong>
                        </span>
                        <small>
                          {g.cells.length} celdas en esta página ·{" "}
                          Tarifa de la base
                        </small>
                      </span>
                      <b>{money(g.cents)}</b>
                    </button>
                  ))}
                </div>
                {list.hasMore && (
                  <button
                    className="taxi-text-button"
                    onClick={() =>
                      void loadZones(list.zones[list.zones.length - 1]?.cell)}
                    disabled={zoneLoading}
                  >
                    Cargar más zonas<ArrowRight size={16} />
                  </button>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
      {channel && tab === "operations" && (
        <section className="taxi-operations">
          <TaxiDispatchPanel tenantId={tenantId} waba={waba} canConfigure={canConfigure} preview={preview} onSelect={setCustomer}/>
          <div className="taxi-conversation-list">
            <h2>Conversaciones</h2>
            <p>Últimos 30 días, hasta 50 contactos por consulta.</p>
            <button
              className="taxi-text-button"
              onClick={() => {
                setCustomer("");
                void loadOperations("");
              }}
            >
              Ver todos los contactos
            </button>
            {!operations.sessions.length && (
              <p className="taxi-empty-inline">
                Cuando un cliente escriba al bot, aparecerá aquí.
              </p>
            )}
            {operations.sessions.map((s) => (
              <button
                key={s.customer}
                className={"taxi-contact " +
                  (s.customer === customer ? "is-active" : "")}
                disabled={busy || Boolean(pending)}
                onClick={() => setCustomer(s.customer)}
              >
                <MessageSquare size={19} />
                <span>
                  <strong>{s.customer}</strong>
                  <small>
                    {s.mode === "human"
                      ? "Atención de la base"
                      : "Atendido por el bot"} ·{" "}
                    {new Date(s.updatedAt).toLocaleString("es-MX", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="taxi-conversation-detail">
            {!activeConversation
              ? (
                <div className="taxi-empty">
                  <MessageSquare size={34} />
                  <h2>Elige una conversación</h2>
                  <p>
                    Podrás ver los últimos mensajes, tomar la atención o dejar
                    que el bot siga.
                  </p>
                </div>
              )
              : (
                <>
                  <div className="taxi-conversation-head">
                    <div>
                      <h2>{activeConversation.customer}</h2>
                      <p>
                        {activeConversation.mode === "human"
                          ? "La base está atendiendo. El bot no responde por su cuenta."
                          : "El bot tiene el control de esta conversación."}
                      </p>
                    </div>
                    <button
                      className="taxi-secondary"
                      disabled={busy || Boolean(pending)}
                      onClick={() =>
                        write(
                          activeConversation.mode === "human"
                            ? "resume"
                            : "takeover",
                          { customer: activeConversation.customer },
                          activeConversation.revision,
                        )}
                    >
                      <Hand size={17} />
                      {activeConversation.mode === "human"
                        ? "Dejar que atienda el bot"
                        : "Tomar conversación"}
                    </button>
                  </div>
                  <div className="taxi-chat-log">
                    {activeConversation.history.map((h, i) => (
                      <div
                        key={i}
                        className={"taxi-message " +
                          (h.role === "assistant" ? "is-assistant" : "")}
                      >
                        <small>
                          {h.role === "user" ? "Cliente" : "Base / bot"}
                        </small>
                        <p>{h.content}</p>
                      </div>
                    ))}
                  </div>
                  <form
                    className="taxi-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      write("send", {
                        customer: activeConversation.customer,
                        text: message,
                      }, activeConversation.revision);
                    }}
                  >
                    <label>
                      Responder desde la base<textarea
                        maxLength={1500}
                        value={message}
                        onChange={(e) =>
                          setMessageDraft({
                            tenantId,
                            waba,
                            customer,
                            text: e.target.value,
                          })}
                        placeholder={activeConversation.mode === "human"
                          ? "Escribe tu respuesta"
                          : "Toma la conversación para responder"}
                        disabled={activeConversation.mode !== "human" || busy ||
                          Boolean(pending)}
                      />
                    </label>
                    <button
                      className="taxi-primary"
                      disabled={activeConversation.mode !== "human" ||
                        !message.trim() || busy || Boolean(pending) ||
                        !channel.enabled}
                    >
                      <Send size={17} />Poner mensaje en cola
                    </button>
                    <small>
                      Sólo dentro de las 24 horas desde el último mensaje del
                      cliente.
                    </small>
                  </form>
                  {operations.deliveries.length > 0 && (
                    <details className="taxi-deliveries">
                      <summary>Estado de los últimos avisos</summary>
                      {operations.deliveries.map((d, i) => (
                        <p key={i}>
                          <strong>{deliveryLabels[d.state] ?? d.state}</strong>
                          <span>{d.text}</span>
                        </p>
                      ))}
                    </details>
                  )}
                </>
              )}
            {operations.trips.length > 0 && (
              <section className="taxi-trip-list">
                <h3>Viajes de esta consulta</h3>
                {operations.trips.map((t) => (
                  <div key={t.id}>
                    <strong>{t.name} · {money(t.cents)}</strong>
                    <p>{t.origin} → {t.destination}</p>
                    <small>{t.state.replaceAll("_", " ")}</small>
                  </div>
                ))}
              </section>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
