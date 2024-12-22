import type { Coordinates } from "gpx";
import { TrackPoint, distance } from "gpx";
import { derived, get, writable } from "svelte/store";
import { settings } from "$lib/db";
import { _, isLoading, locale } from "svelte-i18n";
import { getElevation } from "$lib/utils";
import { PUBLIC_BROUTER_ADDRESS } from '$env/static/public';

const { routing, routingProfile, privateRoads } = settings;

export const availableProfiles = writable<{ [key: string]: string }>({});

export async function fetchProfiles() {
    try {
        const response = await fetch(`${PUBLIC_BROUTER_ADDRESS}/brouter/getprofiles`);
        if (!response.ok) {
            throw new Error('Failed to fetch profiles');
        }
        const profiles = await response.json();
        const profileMap: { [key: string]: string } = {};
        profiles.forEach((profile: string) => {
            const profileName = profile.replace('.brf', '');
            profileMap[profileName] = profileName;
        });
        availableProfiles.set(profileMap);

        // Set the default profile to the first available one if not already set
        if (Object.keys(profileMap).length > 0 && get(routingProfileSelectItem).value === '') {
            const firstProfile = Object.keys(profileMap)[0];
            routingProfileSelectItem.set({ value: firstProfile, label: firstProfile });
        }
    } catch (error) {
        console.error('Error fetching profiles:', error);
    }
}

// Fetch profiles on module load
fetchProfiles();

export const routingProfileSelectItem = writable({
    value: '',
    label: ''
});

derived([routingProfile, locale, isLoading], ([profile, l, i]) => [profile, l, i]).subscribe(([profile, l, i]) => {
    if (!i && profile !== '' && (profile !== get(routingProfileSelectItem).value || get(_)(`${profile}`) !== get(routingProfileSelectItem).label) && l !== null) {
        routingProfileSelectItem.update((item) => {
            item.value = profile;
            item.label = get(_)(`${profile}`);
            return item;
        });
    }
});
routingProfileSelectItem.subscribe((item) => {
    if (item.value !== '' && item.value !== get(routingProfile)) {
        routingProfile.set(item.value);
    }
});

export function route(points: Coordinates[]): Promise<TrackPoint[]> {
    if (get(routing)) {
        return getRoute(points, get(availableProfiles)[get(routingProfile)], get(privateRoads));
    } else {
        return getIntermediatePoints(points);
    }
}

async function getRoute(points: Coordinates[], brouterProfile: string, privateRoads: boolean): Promise<TrackPoint[]> {
    const url = `${PUBLIC_BROUTER_ADDRESS}?lonlats=${points.map(point => `${point.lon.toFixed(8)},${point.lat.toFixed(8)}`).join('|')}&profile=${brouterProfile + (privateRoads ? '' : '')}&format=geojson&alternativeidx=0`;
    const response = await fetch(url);

    // Check if the response is ok
    if (!response.ok) {
        throw new Error(`${await response.text()}`);
    }

    const geojson = await response.json();

    const route: TrackPoint[] = [];
    const coordinates = geojson.features[0].geometry.coordinates;
    const messages = geojson.features[0].properties.messages;

    const lngIdx = messages[0].indexOf("Longitude");
    const latIdx = messages[0].indexOf("Latitude");
    const tagIdx = messages[0].indexOf("WayTags");
    let messageIdx = 1;
    let tags = messageIdx < messages.length ? getTags(messages[messageIdx][tagIdx]) : {};

    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        route.push(new TrackPoint({
            attributes: {
                lat: coord[1],
                lon: coord[0]
            },
            ele: coord[2] ?? (i > 0 ? route[i - 1].ele : 0)
        }));

        if (messageIdx < messages.length &&
            coordinates[i][0] == Number(messages[messageIdx][lngIdx]) / 1000000 &&
            coordinates[i][1] == Number(messages[messageIdx][latIdx]) / 1000000) {
            messageIdx++;

            if (messageIdx == messages.length) tags = {};
            else tags = getTags(messages[messageIdx][tagIdx]);
        }

        route[route.length - 1].setExtensions(tags);
    }

    return route;
}

function getTags(message: string): { [key: string]: string } {
    const fields = message.split(" ");
    const tags: { [key: string]: string } = {};
    for (let i = 0; i < fields.length; i++) {
        let [key, value] = fields[i].split("=");
        key = key.replace(/:/g, '_');
        tags[key] = value;
    }
    return tags;
}

function getIntermediatePoints(points: Coordinates[]): Promise<TrackPoint[]> {
    const route: TrackPoint[] = [];
    const step = 0.05;

    for (let i = 0; i < points.length - 1; i++) { // Add intermediate points between each pair of points
        const dist = distance(points[i], points[i + 1]) / 1000;
        for (let d = 0; d < dist; d += step) {
            const lat = points[i].lat + d / dist * (points[i + 1].lat - points[i].lat);
            const lon = points[i].lon + d / dist * (points[i + 1].lon - points[i].lon);
            route.push(new TrackPoint({
                attributes: {
                    lat: lat,
                    lon: lon
                }
            }));
        }
    }

    route.push(new TrackPoint({
        attributes: {
            lat: points[points.length - 1].lat,
            lon: points[points.length - 1].lon
        }
    }));

    return getElevation(route).then((elevations) => {
        route.forEach((point, i) => {
            point.ele = elevations[i];
        });
        return route;
    });
}