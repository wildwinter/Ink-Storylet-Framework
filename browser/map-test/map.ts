export interface LocationData {
    left: string;
    top: string;
    title: string;
}

export interface MapDef {
    id: string;
    imgSrc: string;
    locations: Record<string, LocationData>;
}

export class MapManager {
    private _mapContainer: Element;
    private _mapClickHandler: (id: string, title: string) => void;
    private _maps: Record<string, MapDef> = {};
    private _currentMap: MapDef | null = null;

    constructor(containerSelector: string, clickHandler: (id: string, title: string) => void) {
        this._mapContainer = document.querySelector(containerSelector)!;
        this._mapClickHandler = clickHandler;
    }

    addMap(map: MapDef): void {
        this._maps[map.id] = map;
    }

    setMap(mapId: string): void {
        const map = this._maps[mapId];
        if (!map) {
            console.error(`Map '${mapId}' not found.`);
            return;
        }

        this._mapContainer.innerHTML = `<img src="${map.imgSrc}" alt="Map Image" class="map-image"/>`;

        for (const [id, data] of Object.entries(map.locations)) {
            this._addSymbol(id, data);
        }

        this._currentMap = map;
    }

    getCurrentMapName(): string | null {
        return this._currentMap ? this._currentMap.id : null;
    }

    showSymbol(id: string): void {
        const el = this._getSymbolElement(id) as HTMLElement | null;
        if (el) el.style.display = 'block';
    }

    hideSymbol(id: string): void {
        const el = this._getSymbolElement(id) as HTMLElement | null;
        if (el) el.style.display = 'none';
    }

    setSymbolDesc(id: string, desc: string): void {
        const el = this._getSymbolElement(id);
        if (!el) return;
        const descEl = el.querySelector('.tooltip-description');
        el.setAttribute('data-tooltip-description', desc);
        if (descEl) descEl.setAttribute('data-description', desc);
    }

    iterateSymbols(callback: (element: Element, id: string, title: string, isVisible: boolean) => void): void {
        const allSymbols = this._mapContainer.querySelectorAll('.map-hit-area');
        allSymbols.forEach(element => {
            const id = element.getAttribute('data-location-id')!;
            const title = element.getAttribute('data-tooltip-title')!;
            const isVisible = (element as HTMLElement).style.display !== 'none';
            callback(element, id, title, isVisible);
        });
    }

    lockMap(): void {
        this._mapContainer.classList.add('locked');
    }

    unlockMap(): void {
        this._mapContainer.classList.remove('locked');
    }

    private _addSymbol(id: string, data: LocationData): void {
        const html = `
            <div
                class="map-hit-area"
                id="map-${id}"
                style="left: ${data.left}; top: ${data.top}; display:none;"
                data-location-id="${id}"
                data-tooltip-title="${data.title}"
                data-tooltip-description=""
            >
                <div class="map-symbol-visual"></div>
                <div class="map-tooltip">
                    <div class="tooltip-title" data-title="${data.title}"></div>
                    <div class="tooltip-description" data-description=""></div>
                </div>
            </div>
        `;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html.trim();
        const newArea = tempDiv.firstChild as HTMLElement;
        this._mapContainer.appendChild(newArea);

        newArea.addEventListener('click', (e) => {
            e.stopPropagation();
            const locId = newArea.getAttribute('data-location-id')!;
            const title = newArea.getAttribute('data-tooltip-title')!;
            this._mapClickHandler(locId, title);
        });
    }

    private _getSymbolElement(id: string): Element | null {
        return document.getElementById(`map-${id}`);
    }
}
