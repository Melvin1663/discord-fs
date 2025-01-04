const { model, Schema } = require('mongoose');

module.exports = model(
  "Files",
  new Schema({
    _id: Schema.Types.ObjectId,
    name: String,
    size: Number,
    created: Date,
    lastModified: Date,
    chunks: [String],
    uploading: Boolean
  }, { versionKey: false }),
  "files"
);