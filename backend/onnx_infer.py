"""YOLOv8 ONNX inference (CPU) without PyTorch — adapted from Ultralytics ONNXRuntime example (AGPL-3.0)."""
from __future__ import annotations

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image

# COCO 80 (order matches YOLOv8n pretrained)
COCO80 = [
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush",
]


def _letterbox(
    img: np.ndarray, new_shape: tuple[int, int]
) -> tuple[np.ndarray, tuple[int, int]]:
    shape = img.shape[:2]
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    new_unpad = (round(shape[1] * r), round(shape[0] * r))
    dw, dh = (new_shape[1] - new_unpad[0]) / 2, (new_shape[0] - new_unpad[1]) / 2
    if shape[::-1] != new_unpad:
        img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = round(dh - 0.1), round(dh + 0.1)
    left, right = round(dw - 0.1), round(dw + 0.1)
    img = cv2.copyMakeBorder(
        img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return img, (top, left)


class OnnxYoloRunner:
    def __init__(
        self,
        onnx_path: str,
        *,
        confidence_thres: float = 0.25,
        iou_thres: float = 0.7,
    ) -> None:
        self.confidence_thres = confidence_thres
        self.iou_thres = iou_thres
        self.session = ort.InferenceSession(
            onnx_path, providers=["CPUExecutionProvider"]
        )
        inp = self.session.get_inputs()[0]
        self._input_name = inp.name
        shape = inp.shape
        self.input_height = int(shape[2])
        self.input_width = int(shape[3])

    def predict_pil(self, pil_image: Image.Image) -> list[dict]:
        img_rgb = np.array(pil_image.convert("RGB"))
        img_h, img_w = img_rgb.shape[:2]
        img_lb, pad = _letterbox(img_rgb, (self.input_height, self.input_width))
        blob = np.transpose(np.array(img_lb) / 255.0, (2, 0, 1))[None].astype(
            np.float32
        )
        outputs = self.session.run(None, {self._input_name: blob})
        return self._postprocess(outputs, pad, img_h, img_w)

    def _postprocess(
        self,
        output: list[np.ndarray],
        pad: tuple[int, int],
        img_height: int,
        img_width: int,
    ) -> list[dict]:
        outputs = np.transpose(np.squeeze(output[0]))
        rows = outputs.shape[0]
        boxes: list[list[int]] = []
        scores: list[float] = []
        class_ids: list[int] = []
        gain = min(self.input_height / img_height, self.input_width / img_width)
        pad_top, pad_left = pad[0], pad[1]
        outputs = outputs.copy()
        outputs[:, 0] -= pad_left
        outputs[:, 1] -= pad_top

        for i in range(rows):
            classes_scores = outputs[i][4:]
            max_score = float(np.amax(classes_scores))
            if max_score < self.confidence_thres:
                continue
            class_id = int(np.argmax(classes_scores))
            x, y, w, h = outputs[i][:4]
            left = int((x - w / 2) / gain)
            top = int((y - h / 2) / gain)
            width = int(w / gain)
            height = int(h / gain)
            class_ids.append(class_id)
            scores.append(max_score)
            boxes.append([left, top, width, height])

        if not boxes:
            return []

        idx = cv2.dnn.NMSBoxes(
            boxes, scores, self.confidence_thres, self.iou_thres
        )
        if idx is None or len(idx) == 0:
            return []

        out: list[dict] = []
        for i in np.asarray(idx).flatten():
            i = int(i)
            box = boxes[i]
            score = scores[i]
            cid = class_ids[i]
            label = COCO80[cid] if 0 <= cid < len(COCO80) else str(cid)
            out.append(
                {
                    "label": label,
                    "confidence": round(score, 2),
                    "bbox": {
                        "x": box[0],
                        "y": box[1],
                        "width": box[2],
                        "height": box[3],
                    },
                }
            )
        return out
