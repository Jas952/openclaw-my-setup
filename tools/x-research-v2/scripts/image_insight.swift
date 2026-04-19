#!/usr/bin/env swift
import Foundation
import Vision
import CoreGraphics
import ImageIO

func emit(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"ocr\":\"\",\"labels\":[]}")
    }
}

guard CommandLine.arguments.count >= 2 else {
    emit(["ocr": "", "labels": []])
    exit(0)
}

let imagePath = CommandLine.arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    emit(["ocr": "", "labels": []])
    exit(0)
}

var recognizedText: [String] = []
var labels: [String] = []

let textRequest = VNRecognizeTextRequest { request, _ in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    for obs in observations {
        if let top = obs.topCandidates(1).first {
            let t = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty {
                recognizedText.append(t)
            }
        }
    }
}
textRequest.recognitionLevel = .accurate
textRequest.usesLanguageCorrection = true
textRequest.recognitionLanguages = ["en-US", "ru-RU"]

let classifyRequest = VNClassifyImageRequest { request, _ in
    guard let observations = request.results as? [VNClassificationObservation] else { return }
    for obs in observations.prefix(3) where obs.confidence >= 0.15 {
        labels.append(obs.identifier)
    }
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([textRequest, classifyRequest])
} catch {
    emit(["ocr": "", "labels": []])
    exit(0)
}

let ocr = recognizedText.joined(separator: " ")
emit(["ocr": ocr, "labels": labels])
