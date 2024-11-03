import {supported} from '/js/urls';
import {toggleListener} from '/js/util-webext';
import {bgReady} from './common';
import {onUrlChange} from './navigation-manager';
import * as stateDb from './state-db';

const listeners = new Set();
/** @typedef {{ url:string, styleIds: {[frameId:string]: number[]} }} StyleIdsFrameMap */
/** @type {Map<number,{ url:string, styleIds: StyleIdsFrameMap }>} */
const cache = new Map();

export const onOff = (fn, state = true) => {
  listeners[state ? 'add' : 'delete'](fn);
};

export const get = (tabId, ...keyPath) => {
  let res = cache.get(tabId);
  for (let i = 0; res && i < keyPath.length; i++) res = res[keyPath[i]];
  return res;
};

/** @return {StyleIdsFrameMap|false} */
export const getStyleIds = id => cache.get(id)?.styleIds || false;

/** @type {typeof Map.prototype.entries} */
export const entries = /*@__PURE__*/cache.entries.bind(cache);

/** @type {typeof Map.prototype.keys} */
export const keys = /*@__PURE__*/cache.keys.bind(cache);

/**
 * number of keys is arbitrary, last arg is value, `undefined` will delete the last key from meta
 * (tabId, 'foo', 123) will set tabId's meta to {foo: 123},
 * (tabId, 'foo', 'bar', 'etc', 123) will set tabId's meta to {foo: {bar: {etc: 123}}}
 */
export const set = (tabId, ...args) => {
  const value = args.pop();
  const lastKey = args.pop();
  const del = value === undefined;
  let obj0;
  let obj = cache.get(tabId);
  if (!obj) {
    if (del) return;
    cache.set(tabId, obj = {});
  }
  obj0 = obj;
  for (let i = 0, key; obj && i < args.length; i++) {
    obj = obj[key = args[i]] || !del && (obj[key] = {});
  }
  if (!del) obj[lastKey] = value;
  else if (obj) delete obj[lastKey];
  stateDb.set(tabId, obj0);
};

export const remove = tabId => {
  cache.delete(tabId);
  stateDb.remove(tabId);
};

bgReady.then(() => {
  onUrlChange(({tabId, frameId, url}) => {
    if (frameId) return;
    let obj, oldUrl;
    if ((obj = cache.get(tabId))) oldUrl = obj.url;
    else cache.set(tabId, obj = {});
    obj.url = url;
    stateDb.set(tabId, obj);
    if (!supported(url)) return;
    for (const fn of listeners) {
      try {
        fn({tabId, url, oldUrl});
      } catch (err) {
        console.error(err);
      }
    }
  });
});

stateDb.ready?.then(([dbData, tabs]) => {
  for (const {id, url} of tabs) {
    if (supported(url)) {
      let data = dbData.get(id);
      if (!data ? data = {} : data.url !== url) {
        data.url = url;
        stateDb.set(id, data);
      }
      cache.set(id, data);
    }
  }
  for (const key of dbData.keys()) {
    if (+key >= 0 && !cache.has(key)) stateDb.remove(key);
  }
});

if (!process.env.MV3) { // we don't want these events to start the SW
  toggleListener(chrome.tabs.onRemoved, true, remove);
  toggleListener(chrome.tabs.onReplaced, true, (added, removed) => remove(removed));
}
