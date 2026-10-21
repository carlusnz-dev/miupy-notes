import { OwnedEntity } from "../../../core/domain/owned-entity.js";

export type EventLinkKind = "note" | "event";
/** Relação com item interno. Só tipos que existem e são verificados no backend. */
export type EventLink = { readonly kind: EventLinkKind; readonly id: string };

/** Origem de um evento espelhado do Google; `etag` é o da última leitura. */
export type ExternalRef = { readonly provider: "google"; readonly calendarId: string; readonly externalId: string; readonly etag: string; readonly syncedAt: string; readonly connectionId: string };
/** Cópia de um evento local no Google, criada por consentimento explícito (`reflector`). */
export type Reflection = { readonly googleEventId: string; readonly calendarId: string; readonly etag: string; readonly reflectedVersion: number; readonly reflectedAt: string };

export class CalendarEvent extends OwnedEntity {
  constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly title: string,
    public readonly description: string,
    public readonly location: string,
    /** Dia inteiro: `start`/`end` são datas AAAA-MM-DD e `end` é o último dia (inclusivo). */
    public readonly allDay: boolean,
    /** Com hora: instantes ISO em UTC (`Z`). */
    public readonly start: string,
    public readonly end: string,
    /** Nome IANA usado para exibir/editar; `null` em eventos de dia inteiro. */
    public readonly timeZone: string | null,
    public readonly links: readonly EventLink[],
    public readonly source: "local" | "google",
    public readonly external: ExternalRef | null,
    public readonly reflection: Reflection | null,
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly version: number,
  ) { super(); }
}
