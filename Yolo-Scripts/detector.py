from ultralytics import YOLO


class Detector:

    def __init__(self, model_path="yolov8n.pt"):

        self.model = YOLO(model_path)

    def infer(self, frame, conf_thres=0.4):

        results = self.model.predict(
            source=frame,
            conf=conf_thres,
            imgsz=512,
            verbose=False
            
        )

        detections = []

        r = results[0]

        for box in r.boxes:

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            cls_name = self.model.names[cls_id]

            detections.append({
                "class": cls_name,
                "class_id": cls_id,
                "conf": conf,
                "box": [x1, y1, x2, y2]   # IMPORTANT: xyxy format
            })

        return detections