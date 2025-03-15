import type { LayerTreeType } from '$lib/assets/layers';
import { writable } from 'svelte/store';

export function anySelectedLayer(node: LayerTreeType) {
    return (
        Object.keys(node).find((id) => {
            if (typeof node[id] == 'boolean') {
                if (node[id]) {
                    return true;
                }
            } else {
                if (anySelectedLayer(node[id])) {
                    return true;
                }
            }
            return false;
        }) !== undefined
    );
}

export function getLayers(
    node: LayerTreeType,
    layers: { [key: string]: boolean } = {}
): { [key: string]: boolean } {
    Object.keys(node).forEach((id) => {
        if (typeof node[id] == 'boolean') {
            layers[id] = node[id];
        } else {
            getLayers(node[id], layers);
        }
    });
    return layers;
}

export function isSelected(node: LayerTreeType, id: string) {
    return Object.keys(node).some((key) => {
        if (key === id) {
            return node[key];
        }
        if (typeof node[key] !== 'boolean' && isSelected(node[key], id)) {
            return true;
        }
        return false;
    });
}

export function toggle(node: LayerTreeType, id: string) {
    Object.keys(node).forEach((key) => {
        if (key === id) {
            node[key] = !node[key];
        } else if (typeof node[key] !== 'boolean') {
            toggle(node[key], id);
        }
    });
    return node;
}

export const customBasemapUpdate = writable(0);
