import numpy as np
from scipy.optimize import linear_sum_assignment
import time


# =========================
# IOU (xyxy)
# =========================
def iou(boxA, boxB):

    xA1, yA1, xA2, yA2 = boxA
    xB1, yB1, xB2, yB2 = boxB

    xi1 = max(xA1, xB1)
    yi1 = max(yA1, yB1)
    xi2 = min(xA2, xB2)
    yi2 = min(yA2, yB2)

    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)

    areaA = max(0, xA2 - xA1) * max(0, yA2 - yA1)
    areaB = max(0, xB2 - xB1) * max(0, yB2 - yB1)

    union = areaA + areaB - inter

    return inter / union if union > 0 else 0.0


# =========================
# TRACK OBJECT
# =========================
class Track:

    def __init__(self, tid, det, timestamp):

        self.id = tid
        self.box = det["box"]
        self.class_name = det["class"]
        self.class_id = det["class_id"]
        self.conf = det["conf"]

        self.first_seen = timestamp
        self.last_seen = timestamp
        self.age = 0

        self.hits = 1
        self.missed = 0

    def update(self, det, timestamp):

        self.box = det["box"]
        self.class_name = det["class"]
        self.class_id = det["class_id"]
        self.conf = det["conf"]

        self.last_seen = timestamp
        self.hits += 1
        self.missed = 0


# =========================
# TRACKER
# =========================
class Tracker:

    def __init__(self, max_age=10, iou_threshold=0.4):

        self.max_age = max_age
        self.iou_threshold = iou_threshold

        self.next_id = 0
        self.tracks = {}

    # =========================
    # UPDATE
    # =========================
    def update(self, detections, timestamp=None):

        if timestamp is None:
            timestamp = time.time()

        track_ids = list(self.tracks.keys())

        matched_tracks = set()
        matched_dets = set()

        output = []

        # =========================
        # MATCHING
        # =========================
        if len(track_ids) > 0 and len(detections) > 0:

            cost = np.zeros((len(track_ids), len(detections)))

            for i, tid in enumerate(track_ids):
                for j, det in enumerate(detections):

                    cost[i, j] = 1 - iou(
                        self.tracks[tid].box,
                        det["box"]
                    )

            row_ind, col_ind = linear_sum_assignment(cost)

            for r, c in zip(row_ind, col_ind):

                iou_score = 1 - cost[r, c]

                if iou_score >= self.iou_threshold:

                    tid = track_ids[r]

                    self.tracks[tid].update(detections[c], timestamp)

                    matched_tracks.add(tid)
                    matched_dets.add(c)

        # =========================
        # CREATE NEW TRACKS
        # =========================
        for i, det in enumerate(detections):

            if i in matched_dets:
                continue

            tid = self.next_id
            self.next_id += 1

            self.tracks[tid] = Track(tid, det, timestamp)

            matched_tracks.add(tid)

        # =========================
        # AGE + MISS HANDLING
        # =========================
        to_delete = []

        for tid, tr in self.tracks.items():

            if tid in matched_tracks:
                tr.age = 0
            else:
                tr.age += 1
                tr.missed += 1

            if tr.age > self.max_age:
                to_delete.append(tid)

        # =========================
        # OUTPUT CLEAN TRACKS
        # =========================
        for tid, tr in self.tracks.items():

            if tid in to_delete:
                continue

            output.append({
                "track_id": tid,
                "box": tr.box,
                "class": tr.class_name,
                "class_id": tr.class_id,
                "conf": tr.conf,
                "age": tr.age,
                "hits": tr.hits,
                "last_seen": tr.last_seen,
                "first_seen": tr.first_seen
            })

        for tid in to_delete:
            del self.tracks[tid]

        return output