# -*- coding: utf-8 -*-
"""多地图源适配器的公共约定。"""

import datetime
import math

SOURCE_LABELS = {
    "amap": "高德",
    "baidu": "百度",
}
SOURCE_ORDER = ["amap", "baidu"]

DEDUPE_METERS = 50.0


class SourceError(Exception):
    """某个源取数失败；调用方保留该源上一次数据。"""


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def epoch_to_iso(value):
    try:
        stamp = int(float(value))
    except (TypeError, ValueError):
        return None
    if stamp <= 0:
        return None
    tz = datetime.timezone(datetime.timedelta(hours=8))
    return datetime.datetime.fromtimestamp(stamp, tz=tz).isoformat(timespec="seconds")


def clean_text(value):
    return str(value or "").strip()


def unique_tags(values):
    out = []
    for value in values or []:
        tag = clean_text(value)
        if tag and tag not in out:
            out.append(tag)
    return out


def haversine(lng1, lat1, lng2, lat2):
    radius = 6371008.8
    rad = math.pi / 180.0
    d_lat = (lat2 - lat1) * rad
    d_lng = (lng2 - lng1) * rad
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lng / 2) ** 2)
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def make_item(source, source_id, name, address, lng, lat, tags=None,
              raw_lng=None, raw_lat=None, raw_coord_sys="gcj02", created_at=None):
    """统一地点结构：lng/lat 固定为 GCJ-02（页面展示用），raw 保留源站原值。"""
    return {
        "id": "%s:%s" % (source, source_id),
        "source": source,
        "sourceIds": {source: str(source_id)},
        "sources": [source],
        "name": clean_text(name),
        "address": clean_text(address),
        "lng": round(float(lng), 6),
        "lat": round(float(lat), 6),
        "coordSys": "gcj02",
        "rawLng": round(float(raw_lng if raw_lng is not None else lng), 6),
        "rawLat": round(float(raw_lat if raw_lat is not None else lat), 6),
        "rawCoordSys": raw_coord_sys,
        "tags": unique_tags(tags),
        "createdAt": created_at,
    }
