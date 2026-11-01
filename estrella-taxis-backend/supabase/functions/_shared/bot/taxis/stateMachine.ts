import {emptyDraft,type TaxiDecision,type TaxiInbound,type TaxiSession}from'./contracts.ts';
import { TrackingError } from "../../tracking/contracts.ts";
import { cancelsTaxi,resetCommand,defersDestination } from "./policy.ts";

export type ConversationPhase =
  | "human"
  | "searching"
  | "en_route"
  | "location_role"
  | "origin"
  | "destination"
  | "name"
  | "review"
  | "review_expired"
  | "ready_for_review";
export function conversationPhase(
  s: TaxiSession,
  now: number,
): ConversationPhase {
  if (s.mode === "human") return "human";
  if (s.active?.state === "buscando_conductor") return "searching";
  if (s.active?.state === "en_camino") return "en_route";
  const d = s.draft;
  if (d.pendingLocation || d.awaitingLocation === "choice") {
    return "location_role";
  }
  if (d.awaitingLocation === "destination") return "destination";
  if (!d.origin || d.origin.source !== 'gps' || !d.pickupMessageId || d.awaitingLocation === "origin") return "origin";
  if(!hasDestination(d)&&d.destinationDeferred!==true)return 'destination';
  if (!d.name) return "name";
  if (!d.confirmation || !d.expiresAt) return "ready_for_review";
  return Date.parse(d.expiresAt) > now ? "review" : "review_expired";
}
export function currentConsent(
  messages: readonly TaxiInbound[],
  token: string | null,
): boolean {
  return token !== null && messages.length === 1 && messages[0].type === "button" && messages[0].button === "txc_" + token;
}
/** Facts persisted by the backend, not a step or completion invented by the model. */
export function taxiProgress(s:TaxiSession,now:number){
  const phase=conversationPhase(s,now),d=s.draft;
  return {phase,hasPickupGps:Boolean(d.origin?.source==='gps'&&d.pickupMessageId),hasPassengerName:Boolean(d.name),missing:[...(!d.origin||d.origin.source!=='gps'||!d.pickupMessageId?['pickup_gps']:[]),...(!hasDestination(d)&&d.destinationDeferred!==true?['destination_choice']:[]),...(!d.name?['passenger_name']:[]),...(d.fareMode!=='quoted'||d.quoteCents===null?['server_fare']:[])],destinationOptional:true,destinationDeferred:d.destinationDeferred===true,confirmation:'current_button_only',hasPickupNote:Boolean(d.pickupText),hasDestination:hasDestination(d),canRequest:phase==='review'&&d.fareMode==='quoted'&&d.quoteCents!==null};
}
export function hasDestination(d:TaxiSession['draft']):boolean{return Boolean(d.destination||d.destinationText||d.destinationArea);}
/** The backend owns the written place; a later detail may refine it before booking. */
export function pendingLocalityContext(s:TaxiSession):{field:'origin'|'destination';query:string}|null{
  const d=s.draft;
  if(!s.active&&d.awaitingLocation===null&&d.destinationText&&!d.destination&&!d.destinationArea&&!d.destinationDeferred)return{field:'destination',query:d.destinationText};
  const field=d.awaitingLocation;
  if(field!=='origin'&&field!=='destination')return null;
  const query=field==='origin'?s.draft.pickupText:s.draft.destinationText;
  if(!query||field==='origin'&&s.draft.origin||field==='destination'&&(s.draft.destination||s.draft.destinationArea||s.draft.destinationDeferred===true))return null;
  return{field,query};
}
/** Derived state: the persisted session remains the single source of truth. */
export function assertTaxiTransition(
  s: TaxiSession,
  messages: readonly TaxiInbound[],
  d: TaxiDecision,
  now: number,
): void {
  const fail = (): never => {
    throw new TrackingError(
      500,
      "taxi_transition_invalid",
      "La decisión no corresponde al estado actual del viaje.",
    );
  };
  if (
    !messages.length || d.messages.length > 3 ||
    d.messages.some((m) => m.to !== messages.at(-1)?.from)
  ) fail();
  if(d.draft.fareMode==='unquoted'&&(d.draft.quoteCents!==null||d.draft.quoteH3!==null))fail();
  if(d.draft.destinationDeferred===true&&s.draft.destinationDeferred!==true){
    const event=messages[0];
    const currentButton=s.draft.awaitingLocation==='destination'&&Boolean(s.draft.destinationPrompt)&&Boolean(s.draft.expiresAt)&&Date.parse(s.draft.expiresAt??'')>now&&event.type==='button'&&event.button==='txd_'+s.draft.destinationPrompt;
    if(d.action!=='draft'||messages.length!==1||hasDestination(d.draft)||!(currentButton||event.type==='text'&&defersDestination(event.text)))fail();
  }
  if (d.messages.some((m) => m.locationRequest && (
    !['draft','reset'].includes(d.action) || s.mode !== 'bot' ||
    (s.active && ['buscando_conductor', 'en_camino'].includes(s.active.state)) ||
    d.draft.awaitingLocation !== m.locationRequest || d.draft.pendingLocation ||
    d.draft.confirmation || Boolean(m.buttons?.length) || m.text.length > 1024
  ))) fail();
  if (
    s.mode === "human" &&
    !["reply", "reset", "human", "driver_accept", "driver_reject", "driver_finish"]
      .includes(d.action)
  ) fail();
  if(d.action==='reset'){
    const needsPin=s.mode==='bot'&&!(s.active&&['buscando_conductor','en_camino'].includes(s.active.state));
    const expected={...emptyDraft(),awaitingLocation:needsPin?'origin':null};
    if(!messages.some(m=>m.type==='text'&&resetCommand(m.text))||d.confirmation!==null||d.tripId!==null||d.offerId!==null||d.candidates.length||
      Object.keys(d.draft).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>JSON.stringify(d.draft[key as keyof typeof expected])!==JSON.stringify(value)))fail();
  }else if (d.action === "confirm") {
    if (
      conversationPhase(s, now) !== "review" ||
      d.confirmation !== s.draft.confirmation ||
      !currentConsent(messages, s.draft.confirmation) || s.draft.fareMode!=='quoted' || s.draft.quoteCents===null
    ) fail();
  } else if (d.action === "cancel") {
    if (
      !s.active ||
      !["buscando_conductor", "en_camino"].includes(s.active.state) ||
      d.tripId !== s.active.id || !cancelsTaxi(
        messages.map((m) => m.text).filter(Boolean).join("\n"),
      )
    ) fail();
  } else if (d.action.startsWith("driver_")) {
    const prefix = d.action === "driver_accept"
      ? "txa_"
      : d.action === "driver_reject"
      ? "txr_"
      : "txf_";
    if (
      !d.offerId || messages.length !== 1 || messages[0].type !== "button" ||
      messages[0].button !== prefix + d.offerId
    ) fail();
  }
  if (d.action === "draft" && d.draft.confirmation) {
    if (
      conversationPhase(
        { ...s, active: null, mode: "bot", draft: d.draft },
        now,
      ) !== "review" || d.draft.fareMode!=='quoted' || d.draft.quoteCents===null
    ) fail();
    if (Date.parse(d.draft.expiresAt ?? "") > now + 11 * 60000) fail();
    const changed =
      (["name", "origin", "destination", "quoteCents", "quoteH3", "fareMode", "pickupText", "destinationText", "destinationArea", "quoteBasis", "destinationDeferred", "destinationPrompt"] as const)
        .some((key) =>
          JSON.stringify(s.draft[key]) !== JSON.stringify(d.draft[key])
        );
    if (changed && d.draft.confirmation === s.draft.confirmation) fail();
  }
}

export type Lifecycle = "trip" | "offer" | "delivery";
export const LIFECYCLES: Readonly<
  Record<Lifecycle, Readonly<Record<string, readonly string[]>>>
> = {
  trip: {
    buscando_conductor: ["en_camino", "cancelado", "cancelado_timeout"],
    en_camino: ["completado", "cancelado"],
    completado: [],
    cancelado: [],
    cancelado_timeout: [],
  },
  offer: {
    offered: ["accepted", "rejected", "revoked", "expired"],
    accepted: ["finished", "revoked"],
    rejected: [],
    revoked: [],
    expired: [],
    finished: [],
  },
  delivery: {
    pending: ["sending", "failed"],
    sending: ["accepted", "delivered", "read", "failed", "uncertain"],
    uncertain: ["accepted", "delivered", "read", "failed"],
    accepted: ["delivered", "read", "failed"],
    delivered: ["read"],
    read: [],
    failed: [],
  },
};
export function lifecycleAllows(
  kind: Lifecycle,
  before: string,
  after: string,
): boolean {
  const allowed = LIFECYCLES[kind][before];
  return allowed !== undefined && (before === after || allowed.includes(after));
}
