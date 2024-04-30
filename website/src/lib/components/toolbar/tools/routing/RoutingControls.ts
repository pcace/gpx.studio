import { distance, type Coordinates, type GPXFile, TrackPoint, TrackSegment } from "gpx";
import { get, type Writable } from "svelte/store";
import { computeAnchorPoints } from "./Simplify";
import mapboxgl from "mapbox-gl";
import { route } from "./Routing";
import { applyToFileElement } from "$lib/stores";

import { toast } from "svelte-sonner";

import { _ } from "svelte-i18n";

export class RoutingControls {
    map: mapboxgl.Map;
    file: Writable<GPXFile>;
    anchors: AnchorWithMarker[] = [];
    shownAnchors: AnchorWithMarker[] = [];
    popup: mapboxgl.Popup;
    popupElement: HTMLElement;
    temporaryAnchor: AnchorWithMarker;
    unsubscribe: () => void = () => { };

    toggleAnchorsForZoomLevelAndBoundsBinded: () => void = this.toggleAnchorsForZoomLevelAndBounds.bind(this);
    showTemporaryAnchorBinded: (e: any) => void = this.showTemporaryAnchor.bind(this);
    updateTemporaryAnchorBinded: (e: any) => void = this.updateTemporaryAnchor.bind(this);
    appendAnchorBinded: (e: mapboxgl.MapMouseEvent) => void = this.appendAnchor.bind(this);

    constructor(map: mapboxgl.Map, file: Writable<GPXFile>, popup: mapboxgl.Popup, popupElement: HTMLElement) {
        this.map = map;
        this.file = file;
        this.popup = popup;
        this.popupElement = popupElement;

        let point = new TrackPoint({
            attributes: {
                lat: 0,
                lon: 0
            }
        });
        this.temporaryAnchor = this.createAnchor(point, new TrackSegment());
        this.temporaryAnchor.marker.getElement().classList.remove('z-10'); // Show below the other markers

        this.add();
    }

    add() {
        this.map.on('zoom', this.toggleAnchorsForZoomLevelAndBoundsBinded);
        this.map.on('move', this.toggleAnchorsForZoomLevelAndBoundsBinded);
        this.map.on('click', this.appendAnchorBinded);
        this.map.on('mousemove', get(this.file)._data.layerId, this.showTemporaryAnchorBinded);

        this.unsubscribe = this.file.subscribe(this.updateControls.bind(this));
    }

    updateControls() { // Update the markers when the file changes
        for (let segment of get(this.file).getSegments()) {
            if (segment.trkpt.length === 0) { // Empty segment, skip
                continue;
            }

            if (!segment._data.anchors) { // New segment, compute anchor points for it
                computeAnchorPoints(segment);
            }

            if (!segment.trkpt[0]._data.anchor) { // First point is not an anchor, make it one
                segment.trkpt[0]._data.anchor = true;
                segment.trkpt[0]._data.zoom = 0;
            }

            if (!segment.trkpt[segment.trkpt.length - 1]._data.anchor) { // Last point is not an anchor, make it one
                segment.trkpt[segment.trkpt.length - 1]._data.anchor = true;
                segment.trkpt[segment.trkpt.length - 1]._data.zoom = 0;
            }

            let anchorIndex = 0;
            for (let point of segment.trkpt) { // Update the existing anchors (could be improved by matching the existing anchors with the new ones?)
                if (point._data.anchor) {
                    if (anchorIndex < this.anchors.length) {
                        this.anchors[anchorIndex].point = point;
                        this.anchors[anchorIndex].segment = segment;
                        this.anchors[anchorIndex].marker.setLngLat(point.getCoordinates());
                    } else {
                        this.anchors.push(this.createAnchor(point, segment));
                    }
                    anchorIndex++;
                }
            }

            while (anchorIndex < this.anchors.length) { // Remove the extra anchors
                this.anchors.pop()?.marker.remove();
            }
        }

        this.toggleAnchorsForZoomLevelAndBounds();
    }

    remove() {
        for (let anchor of this.anchors) {
            anchor.marker.remove();
        }
        this.map.off('zoom', this.toggleAnchorsForZoomLevelAndBoundsBinded);
        this.map.off('move', this.toggleAnchorsForZoomLevelAndBoundsBinded);
        this.map.off('click', this.appendAnchorBinded);
        this.map.off('mousemove', get(this.file)._data.layerId, this.showTemporaryAnchorBinded);
        this.map.off('mousemove', this.updateTemporaryAnchorBinded);

        this.unsubscribe();
    }

    createAnchor(point: TrackPoint, segment: TrackSegment): AnchorWithMarker {
        let element = document.createElement('div');
        element.className = `h-3 w-3 rounded-full bg-white border-2 border-black cursor-pointer`;

        let marker = new mapboxgl.Marker({
            draggable: true,
            className: 'z-10',
            element
        }).setLngLat(point.getCoordinates());

        let anchor = {
            point,
            segment,
            marker,
            inZoom: false
        };

        let lastDragEvent = 0;
        marker.on('dragstart', (e) => {
            lastDragEvent = Date.now();
            this.map.getCanvas().style.cursor = 'grabbing';
            element.classList.remove('cursor-pointer');
            element.classList.add('cursor-grabbing');
        });
        marker.on('dragend', (e) => {
            lastDragEvent = Date.now();
            this.map.getCanvas().style.cursor = '';
            element.classList.remove('cursor-grabbing');
            element.classList.add('cursor-pointer');
            this.moveAnchor(anchor);
        });
        marker.getElement().addEventListener('click', (e) => {
            e.stopPropagation();

            if (Date.now() - lastDragEvent < 100) { // Prevent click event during drag
                return;
            }

            if (e.shiftKey) {
                this.deleteAnchor(anchor);
                return;
            }

            marker.setPopup(this.popup);
            marker.togglePopup();

            let deleteThisAnchor = this.getDeleteAnchor(anchor);
            this.popupElement.addEventListener('delete', deleteThisAnchor); // Register the delete event for this anchor
            this.popup.once('close', () => {
                this.popupElement.removeEventListener('delete', deleteThisAnchor);
            });
        });

        return anchor;
    }

    toggleAnchorsForZoomLevelAndBounds() { // Show markers only if they are in the current zoom level and bounds
        this.shownAnchors.splice(0, this.shownAnchors.length);

        let zoom = this.map.getZoom();
        this.anchors.forEach((anchor) => {
            anchor.inZoom = anchor.point._data.zoom <= zoom;
            if (anchor.inZoom && this.map.getBounds().contains(anchor.marker.getLngLat())) {
                anchor.marker.addTo(this.map);
                this.shownAnchors.push(anchor);
            } else {
                anchor.marker.remove();
            }
        });
    }

    showTemporaryAnchor(e: any) {
        if (this.temporaryAnchorCloseToOtherAnchor(e)) {
            return;
        }

        this.temporaryAnchor.point.setCoordinates({
            lat: e.lngLat.lat,
            lon: e.lngLat.lng
        });
        this.temporaryAnchor.marker.setLngLat(e.lngLat).addTo(this.map);

        this.map.on('mousemove', this.updateTemporaryAnchorBinded);
    }

    updateTemporaryAnchor(e: any) {
        if (this.temporaryAnchor.marker.getElement().classList.contains('cursor-grabbing')) { // Do not hide if it is being dragged, and stop listening for mousemove
            this.map.off('mousemove', this.updateTemporaryAnchorBinded);
            return;
        }

        if (e.point.dist(this.map.project(this.temporaryAnchor.point.getCoordinates())) > 20 || this.temporaryAnchorCloseToOtherAnchor(e)) { // Hide if too far from the layer
            this.temporaryAnchor.marker.remove();
            this.map.off('mousemove', this.updateTemporaryAnchorBinded);
            return;
        }

        this.temporaryAnchor.marker.setLngLat(e.lngLat); // Update the position of the temporary anchor
    }

    temporaryAnchorCloseToOtherAnchor(e: any) {
        for (let anchor of this.shownAnchors) {
            if (e.point.dist(this.map.project(anchor.marker.getLngLat())) < 10) {
                return true;
            }
        }
        return false;
    }

    async moveAnchor(anchorWithMarker: AnchorWithMarker) { // Move the anchor and update the route from and to the neighbouring anchors
        let coordinates = {
            lat: anchorWithMarker.marker.getLngLat().lat,
            lon: anchorWithMarker.marker.getLngLat().lng
        };

        let anchor = anchorWithMarker as Anchor;
        if (anchorWithMarker === this.temporaryAnchor) { // Temporary anchor, need to find the closest point of the segment and create an anchor for it
            this.temporaryAnchor.marker.remove();
            anchor = this.getPermanentAnchor();
        }

        let [previousAnchor, nextAnchor] = this.getNeighbouringAnchors(anchor);

        let anchors = [];
        let targetCoordinates = [];

        if (previousAnchor !== null) {
            anchors.push(previousAnchor);
            targetCoordinates.push(previousAnchor.point.getCoordinates());
        }

        anchors.push(anchor);
        targetCoordinates.push(coordinates);

        if (nextAnchor !== null) {
            anchors.push(nextAnchor);
            targetCoordinates.push(nextAnchor.point.getCoordinates());
        }

        let success = await this.routeBetweenAnchors(anchors, targetCoordinates);

        if (!success) { // Route failed, revert the anchor to the previous position
            anchorWithMarker.marker.setLngLat(anchorWithMarker.point.getCoordinates());
        }
    }

    getPermanentAnchor(): Anchor {
        // Find the closest point closest to the temporary anchor
        let minDistance = Number.MAX_VALUE;
        let minPoint: TrackPoint | null = null;
        let minSegment: TrackSegment | null = null;
        for (let segment of get(this.file).getSegments()) {
            for (let point of segment.trkpt) {
                let dist = distance(point.getCoordinates(), this.temporaryAnchor.point.getCoordinates());
                if (dist < minDistance) {
                    minDistance = dist;
                    minPoint = point;
                    minSegment = segment;
                }
            }
        }

        if (!minPoint || !minSegment) {
            return this.temporaryAnchor;
        }

        return {
            segment: minSegment,
            point: minPoint,
        };
    }

    getDeleteAnchor(anchor: Anchor) {
        return () => this.deleteAnchor(anchor);
    }

    async deleteAnchor(anchor: Anchor) { // Remove the anchor and route between the neighbouring anchors if they exist
        this.popup.remove();

        let [previousAnchor, nextAnchor] = this.getNeighbouringAnchors(anchor);

        if (previousAnchor === null && nextAnchor === null) { // Only one point, remove it
            applyToFileElement(this.file, anchor.segment, (segment) => {
                segment.replace(0, 0, []);
            }, true);
        } else if (previousAnchor === null) { // First point, remove trackpoints until nextAnchor
            applyToFileElement(this.file, anchor.segment, (segment) => {
                segment.replace(0, nextAnchor.point._data.index - 1, []);
            }, true);
        } else if (nextAnchor === null) { // Last point, remove trackpoints from previousAnchor
            applyToFileElement(this.file, anchor.segment, (segment) => {
                segment.replace(previousAnchor.point._data.index + 1, segment.trkpt.length - 1, []);
            }, true);
        } else { // Route between previousAnchor and nextAnchor
            this.routeBetweenAnchors([previousAnchor, nextAnchor], [previousAnchor.point.getCoordinates(), nextAnchor.point.getCoordinates()]);
        }
    }

    async appendAnchor(e: mapboxgl.MapMouseEvent) { // Add a new anchor to the end of the last segment
        let lastAnchor = this.anchors[this.anchors.length - 1];

        let newPoint = new TrackPoint({
            attributes: {
                lat: e.lngLat.lat,
                lon: e.lngLat.lng
            }
        });
        newPoint._data.anchor = true;
        newPoint._data.zoom = 0;

        if (!lastAnchor) {
            // TODO, create segment if it does not exist
            applyToFileElement(this.file, get(this.file).getSegments()[0], (segment) => {
                segment.replace(0, 0, [newPoint]);
            }, true);
            return;
        }

        newPoint._data.index = lastAnchor.segment.trkpt.length - 1; // Do as if the point was the last point in the segment
        let newAnchor = {
            point: newPoint,
            segment: lastAnchor.segment
        };

        await this.routeBetweenAnchors([lastAnchor, newAnchor], [lastAnchor.point.getCoordinates(), newAnchor.point.getCoordinates()]);
    }

    getNeighbouringAnchors(anchor: Anchor): [Anchor | null, Anchor | null] {
        let previousAnchor: Anchor | null = null;
        let nextAnchor: Anchor | null = null;

        for (let i = 0; i < this.anchors.length; i++) {
            if (this.anchors[i].segment === anchor.segment && this.anchors[i].inZoom) {
                if (this.anchors[i].point._data.index < anchor.point._data.index) {
                    if (!previousAnchor || this.anchors[i].point._data.index > previousAnchor.point._data.index) {
                        previousAnchor = this.anchors[i];
                    }
                } else if (this.anchors[i].point._data.index > anchor.point._data.index) {
                    if (!nextAnchor || this.anchors[i].point._data.index < nextAnchor.point._data.index) {
                        nextAnchor = this.anchors[i];
                    }
                }
            }
        }

        return [previousAnchor, nextAnchor];
    }

    async routeBetweenAnchors(anchors: Anchor[], targetCoordinates: Coordinates[]): Promise<boolean> {
        let segment = anchors[0].segment;

        if (anchors.length === 1) { // Only one anchor, update the point in the segment
            applyToFileElement(this.file, segment, (segment) => {
                segment.replace(0, 0, [new TrackPoint({
                    attributes: targetCoordinates[0],
                })]);
            }, true);
            return true;
        }

        let response: TrackPoint[];
        try {
            response = await route(targetCoordinates);
        } catch (e: any) {
            if (e.message.includes('from-position not mapped in existing datafile')) {
                toast.error(get(_)("toolbar.routing.error.from"));
            } else if (e.message.includes('via1-position not mapped in existing datafile')) {
                toast.error(get(_)("toolbar.routing.error.via"));
            } else if (e.message.includes('to-position not mapped in existing datafile')) {
                toast.error(get(_)("toolbar.routing.error.to"));
            } else if (e.message.includes('Time-out')) {
                toast.error(get(_)("toolbar.routing.error.timeout"));
            } else {
                toast.error(e.message);
            }
            return false;
        }

        let start = anchors[0].point._data.index + 1;
        let end = anchors[anchors.length - 1].point._data.index - 1;

        if (anchors[0].point._data.index === 0) { // First anchor is the first point of the segment
            anchors[0].point = response[0]; // Update the first anchor in case it was not on a road
            start--; // Remove the original first point
        }

        if (anchors[anchors.length - 1].point._data.index === segment.trkpt.length - 1) { // Last anchor is the last point of the segment
            anchors[anchors.length - 1].point = response[response.length - 1]; // Update the last anchor in case it was not on a road
            end++; // Remove the original last point
        }

        for (let i = 1; i < anchors.length - 1; i++) {
            // Find the closest point to the intermediate anchor
            // and transfer the marker to that point
            let minDistance = Number.MAX_VALUE;
            let minIndex = 0;
            for (let j = 1; j < response.length - 1; j++) {
                let dist = distance(response[j].getCoordinates(), targetCoordinates[i]);
                if (dist < minDistance) {
                    minDistance = dist;
                    minIndex = j;
                }
            }
            anchors[i].point = response[minIndex];
        }

        anchors.forEach((anchor) => {
            anchor.point._data.anchor = true;
            anchor.point._data.zoom = 0; // Make these anchors permanent
        });

        applyToFileElement(this.file, segment, (segment) => {
            segment.replace(start, end, response);
        }, true);

        return true;
    }
}

type Anchor = {
    segment: TrackSegment;
    point: TrackPoint;
};

type AnchorWithMarker = Anchor & {
    marker: mapboxgl.Marker;
    inZoom: boolean;
};