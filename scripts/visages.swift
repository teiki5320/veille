// Détection des visages et des personnes (Vision, macOS) pour cadrer les photos.
// Usage : visages <image>  →  {"visages":[{x,y,l,h}],"corps":[{x,y,l,h}]}
// Coordonnées entre 0 et 1, origine en haut à gauche. L'image doit être déjà tournée (EXIF appliqué).
import Foundation
import Vision

func boites(_ obs: [VNDetectedObjectObservation]?) -> [[String: Double]] {
  (obs ?? []).filter { $0.confidence > 0.5 }.map { o in
    let b = o.boundingBox
    return ["x": Double(b.minX), "y": Double(1 - b.maxY), "l": Double(b.width), "h": Double(b.height)]
  }
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let visages = VNDetectFaceRectanglesRequest()
let corps = VNDetectHumanRectanglesRequest()
corps.upperBodyOnly = false
let handler = VNImageRequestHandler(url: url, options: [:])
try handler.perform([visages, corps])
let sortie: [String: Any] = ["visages": boites(visages.results), "corps": boites(corps.results)]
print(String(data: try JSONSerialization.data(withJSONObject: sortie), encoding: .utf8)!)
