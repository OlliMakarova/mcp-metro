// Единый нормализованный формат данных метро (IMetroDataset).
//
// Формат один для обоих источников. Богатый источник (mosmetro.ru) заполняет все поля,
// скудный (metrobook.ru) — только обязательное ядро: станции с русским названием, линии,
// рёбра с временем в секундах. Весь код маршрутизации и поиска пишется против этого типа:
// отсутствие необязательного поля означает лишь меньше сведений в ответе, без веток по источнику.

/** Источник, из которого получен набор данных */
export type TMetroSource = 'mosmetro' | 'metrobook';

/** Тип линии: обычное метро, Московское центральное кольцо, Московские центральные диаметры */
export type TLineKind = 'metro' | 'mcc' | 'mcd';

/** Название на поддерживаемых языках. Русское название обязательно, остальные — по наличию в источнике */
export interface ILocalizedName {
  ru: string;
  en?: string;
  ar?: string;
  cn?: string;
}

export interface IGeoPoint {
  lat: number;
  lon: number;
}

/** Выход станции в город с маршрутами наземного транспорта поблизости */
export interface IStationExit {
  title?: string;
  exitNumber?: number;
  location?: IGeoPoint;
  /** Номера маршрутов через запятую, как отдаёт источник (например, "270, м40") */
  bus?: string;
  trolleybus?: string;
  tram?: string;
}

/** Первый/последний поезд в направлении stationToId (интервалов движения в открытых данных нет) */
export interface ITrainScheduleEntry {
  stationToId: number;
  stationToName?: string;
  first?: string;
  last?: string;
  dayType?: string;
  weekend?: boolean;
}

export interface IMetroStation {
  /** Идентификатор вершины графа: станция конкретной линии (пересадочный узел — несколько станций) */
  id: number;
  name: ILocalizedName;
  lineId: number;
  /** Время в секундах от входа с улицы до платформы (у станций МЦД в данных отсутствует) */
  enterTimeSec?: number;
  /** Время в секундах от платформы до выхода в город */
  exitTimeSec?: number;
  location?: IGeoPoint;
  exits?: IStationExit[];
  /** Сервисы станции: BANK, ELEVATOR, VENDING и т. п. */
  services?: string[];
  /** Расписание первых/последних поездов по направлениям (ключ — id направления в источнике) */
  scheduleTrains?: Record<string, ITrainScheduleEntry[]>;
  /**
   * Дополнительные названия для неточного поиска. Используется при работе от metrobook:
   * у пересадочного узла там одна подпись («Пушкинская»), и «вторые» имена узла
   * («Тверская», «Чеховская») подтягиваются сюда из последней сохранённой схемы mosmetro.
   */
  searchAliases?: string[];
}

export interface IMetroLine {
  id: number;
  /** У metrobook названий линий нет — поле необязательное */
  name?: ILocalizedName;
  color?: string;
  kind: TLineKind;
}

/** Рекомендация, в какой вагон садиться, чтобы удобнее выйти к переходу */
export interface IWagonHint {
  stationToId?: number;
  stationPrevId?: number;
  /** NEAR_FIRST — ближе к голове, NEAR_END — ближе к хвосту, CENTER — в середину */
  types: string[];
}

export interface IMetroEdge {
  /** ride — поездка между соседними станциями; transfer — пеший переход внутри узла */
  kind: 'ride' | 'transfer';
  /** Уникальный ключ ребра в наборе данных (нужен для применения закрытий и алгоритма Йена) */
  edgeId: string;
  fromId: number;
  toId: number;
  /** Время в секундах (в источнике mosmetro поле называется pathLength, но содержит секунды) */
  timeSec: number;
  /** Двустороннее ли ребро */
  bi: boolean;
  /** Линия (только для kind='ride') */
  lineId?: number;
  /** Переход по улице (только для kind='transfer') */
  isGround?: boolean;
  /** Рекомендации по вагонам (только для kind='transfer', только mosmetro) */
  wagons?: IWagonHint[];
  /** Временное ребро-обход из уведомления о закрытии */
  isAlternative?: boolean;
}

export type TNotificationStatus = 'CLOSED' | 'EMERGENCY' | 'INFO';

export interface INotificationStationRef {
  stationId: number;
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

/** Уведомление о закрытии/ремонте, действующее в период startDate..endDate */
export interface IMetroNotification {
  id: number | string;
  title?: string;
  description?: string;
  /** ISO-строки местного времени, как отдаёт API */
  startDate: string;
  endDate: string;
  stations: INotificationStationRef[];
  /** edgeId закрытых перегонов и переходов (удалить из графа на период действия) */
  closedEdgeIds: string[];
  /** Временные рёбра-обходы (добавить в граф на период действия) */
  alternativeEdges: IMetroEdge[];
}

export interface IMetroDataset {
  source: TMetroSource;
  /** Когда скачана схема (ISO UTC) */
  schemaFetchedAt: string;
  /** Когда скачаны уведомления; отсутствует, если уведомлений нет (metrobook или mosmetro без них) */
  notificationsFetchedAt?: string;
  stations: IMetroStation[];
  lines: IMetroLine[];
  edges: IMetroEdge[];
  /** Закрытия и ремонты. Есть только у mosmetro; срок жизни файла — 24 часа */
  notifications?: IMetroNotification[];
}

/** Нормализованный граф metrobook.ru — формат файла metrobook-graph.json на диске */
export interface IMetrobookGraphFile {
  source: string;
  fetchedAt: string;
  mapId: number;
  /** lineId -> { type: 0 метро | 1 МЦК | 2 МЦД } */
  lines: Record<string, { type: number }>;
  /** sdid («станция на линии») -> вершина графа */
  stationInstances: Record<string, { stationId: number; lineId: number; name: string | null }>;
  /** sid (физическая станция) -> группа вершин */
  stations: Record<string, { sdids: number[]; name: string | null }>;
  /** Перегоны, time — секунды */
  edges: Array<{ id: number; sdid1: number; sdid2: number; lineId: number; time: number }>;
  /** Пересадки, time — секунды; 999999 означает «переход запрещён» и отбрасывается */
  transfers: Array<{ from: number; to: number; time: number }>;
}

/** Ошибка «данные метро недоступны»: оба источника не отвечают и на диске нет копии */
export class MetroDataUnavailableError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Данные метро недоступны: оба источника (mosmetro.ru, metrobook.ru) не отвечают, локальной копии на диске нет',
    );
    this.name = 'MetroDataUnavailableError';
  }
}
