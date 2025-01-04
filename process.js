const { Partials, Client } = require('discord.js');
require('dotenv').config();
const client = new Client({
  intents: 3276799,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
})
const express = require('express');
const app = express()
const port = 3000
const path = require('path');
const fs = require('fs');
const cors = require('cors')
const busboy = require('connect-busboy');
const splitFile = require('split-file');
const mongoose = require('mongoose');
const filesSchema = require('./schemas/files');
const fetch = require('node-fetch2');

let ru = [];
let availableFiles = [];

app.use(cors());
app.use(busboy());

app.get('/', async (req, res) => {
  return res.sendStatus(200);
});

app.get('/cdn', async (req, res) => {
  try {
    let files = await filesSchema.find().lean();

    res.send({
      status: 200,
      content: JSON.parse(JSON.stringify(files))
    })
  } catch (e) {
    console.log(e)
    return res.sendStatus(404);
  };
});

app.post('/cdn/rename', async (req, res, next) => {
  let { o, n } = req.query;

  let file = await filesSchema.findOne({ name: o });

  if (!file) return res.sendStatus(403);
  await file.updateOne({ $set: { name: n } });
  res.sendStatus(200);
});

app.post('/cdn/delete/:filename', async (req, res, next) => {
  let { filename } = req.params;

  let file = await filesSchema.findOne({ name: filename });

  if (!file) return res.sendStatus(403);
  await file.deleteOne();
  res.sendStatus(200);
})

app.get('/cdn/download/:filename', async (req, res) => {
  let { filename } = req.params;

  if (availableFiles.includes(filename)) return res.download(`./files/${filename}`, e => {
    if (e) {
      console.log(`Error during file download`);
      console.log(e);
      res.status(500);
    }
  });

  const file = await filesSchema.findOne({ name: filename }).lean().catch(console.log);

  if (!file) {
    res.sendStatus(404);
    return console.log(`Failed to get entry for ${filename}`);
  }
  if (file.uploading) {
    res.sendStatus(501);
    return console.log(`File ${filename} is still uploading`);
  }

  let finished = 0;
  let chunkQuantity = file.chunks.length;

  try {
    await Promise.all(file.chunks.map(async id => {
      let msg = await client.channels.cache.get('1248303289208930330').messages.fetch(id);
      try {
        fs.mkdirSync(`./files/_${filename}`, { recursive: true });
        let file = await fetch(msg.attachments.first().attachment);
        if (!file.ok) {
          console.log(`Failed to fetch ${msg.attachments.first().attachment}`)
        } else {
          let fileStream = fs.createWriteStream(`./files/_${filename}/${id}`);

          return new Promise((resolve, reject) => {
            file.body.pipe(fileStream);
            file.body.on('error', reject);
            fileStream.on('finish', () => {
              finished++;
              resolve();
            });
          });
        }
      } catch (e) {
        if (e.code === 'EEXIST') {
          res.sendStatus(409);
          console.log(`Folder _${filename} already exists, aborting.`);
        } else {
          res.sendStatus(500);
          console.log(`Failed to create folder _${filename} while downloading`);
        }
      }
    }))
  } catch (e) {
    console.log(e);
  }

  if (finished == chunkQuantity) {
    let err = 0;
    // console.log(file.chunks.map(id => `./files/_${filename}/${id}`))
    await splitFile.mergeFiles(file.chunks.map(id => `./files/_${filename}/${id}`), `./files/${filename}`).catch(e => {
      console.log(`Could not merge ${filename}`);
      console.log(e);
      err++;
    });
    if (!err) {
      availableFiles.push(filename);
      try {
        fs.rmSync(`./files/_${filename}`, { recursive: true, force: true });
        console.log(`Deleted cache folder for ${filename}`);
      } catch (e) {
        console.log(`Error deleting folder ${filename}`);
        console.log(e);
      }
      setTimeout(() => {
        try {
          fs.unlinkSync(`./files/${filename}`);
          availableFiles.splice(availableFiles.indexOf(filename), 1);
          console.log(`Deleted cache file for ${filename}`)
        } catch (e) {
          console.log(`Error deleting cache file for ${filename}`);
          console.log(e);
        }
      }, 600000)
    }
    res.download(`./files/${filename}`, e => {
      if (e) {
        console.log(`Error during file download`);
        console.log(e);
        res.status(500);
      }
    });
  }
  else res.sendStatus(500).catch(console.log);
})

app.post('/cdn/upload', (req, res, next) => {
  var fstream;

  req.pipe(req.busboy);
  req.busboy.on('file', async (name /*string "file"*/, file, info) => {
    let e_entry = await filesSchema.findOne({ name: info.filename });
    if (e_entry) {
      res.sendStatus(409);
      return console.log(`File with the name ${info.filename} already exists.`);
    }

    console.log("Uploading: " + info.filename);

    let lastDrain = Date.now();

    //Path where image will be uploaded
    fstream = fs.createWriteStream(__dirname + '/files/' + info.filename);
    file.pipe(fstream);

    fstream.on('drain', () => {
      lastDrain = Date.now();
    })

    let checkCancel = setInterval(() => {
      if ((Date.now() - lastDrain) > 60000) fstream.emit('error', { message: "cancelled" });
    }, 10000);

    fstream.on('close', () => {
      console.log("Finished uploading " + info.filename);
      // ru.push(info.filename);
      // console.log('pushed to recently uploaded files')
      clearInterval(checkCancel);
      // console.log('cleared interval');
      // console.log(`triggered busboys finish event`)

      setTimeout(async () => {
        console.log(`set time out initiated`)
        // ru.forEach(async f => {
        //   console.log(`ru.foreach`)
          let f = info.filename;
          let finished = 0;
          let oe = 0;

          let stat = await fs.promises.stat(`./files/${f}`);

          let totalSize = stat.size;
          let parts = Math.ceil(totalSize / maxSize);
          let splitSize = Math.round(maxSize);
          let partInfo = [];

          for (var i = 0; i < parts; i++) {
            partInfo[i] = {
              number: i + 1,
              start: i * splitSize,
              end: i * splitSize + splitSize,
            };
          }

          partInfo[partInfo.length - 1].end = totalSize;

          for await (const info of partInfo) {
            await new Promise((resolve, reject) => {
              if (oe) return reject();
              let err = 0;
              let reader = fs.createReadStream(`./files/${f}`, {
                encoding: null,
                start: info.start,
                end: info.end - 1,
              });

              let maxPaddingCount = String(partInfo.length).length;
              let currentPad = '0'.repeat(maxPaddingCount);

              let unpaddedPartNumber = '' + info.number;
              let partNumber = currentPad.substring(0, currentPad.length - unpaddedPartNumber.length) + unpaddedPartNumber;
              let partName = f + ".sf-part" + partNumber;

              const outputFile = async (filename) => {
                const writer = fs.createWriteStream(filename);
                const pipe = reader.pipe(writer);
                pipe.on("error", () => {
                  console.log(`Error while writing part ${info.number} of ${f}`)
                });
                return pipe.on("finish", async () => {
                  console.log(`Finished writing part ${info.number} of ${f}`);
                  let msg = await client.channels.cache.get('1248303289208930330').send({
                    files: [{
                      attachment: `./files/${partName}`,
                      name: `${f}_${info.number}`
                    }]
                  }).catch(console.log);
                  let entry = await filesSchema.findOne({ name: f });

                  if (!entry) {
                    try {
                      entry = await new filesSchema({
                        _id: new mongoose.mongo.ObjectId(),
                        name: f,
                        size: stat.size, // bytes
                        created: new Date(),
                        lastModified: new Date(),
                        chunks: [],
                        uploading: true
                      }).save().catch(e => {
                        console.log(`Failed to create entry ${f}`);
                        console.log(e);
                        err++;
                        oe++;
                      });
                    } catch (e) {
                      console.log(e);
                      err++;
                      oe++;
                    }
                  }

                  await entry.updateOne({
                    $set: {
                      [`chunks.${info.number - 1}`]: msg.id
                    }
                  }).catch(e => {
                    console.log(`Failed to update entry ${f}`);
                    console.log(e);
                    err++;
                    oe++;
                  });


                  if (!err) {
                    try {
                      fs.unlink(`./files/${partName}`, async (error) => {
                        if (error) return;
                        console.log(`Chunk ${info.number} - ${f} deleted`);
                        ru.splice(ru.indexOf(f), 1);
                        finished++;
                        if (finished == partInfo.length) {
                          console.log(`Finished splitting ${f}!`);
                          availableFiles.push(f);
                          await entry.updateOne({
                            $set: {
                              uploading: false
                            }
                          });
                          setTimeout(() => {
                            try {
                              fs.unlinkSync(`./files/${f}`);
                              availableFiles.splice(availableFiles.indexOf(f), 1);
                              console.log(`Deleted cache file for ${f}`);
                            } catch (e) {
                              console.log(`Failed to delete cache file for ${f}`);
                              console.log(e);
                            }
                          }, 600000);
                        }
                        return resolve();
                      });
                    } catch (e) {
                      console.log(`Could not delete a chunk file`)
                    }
                  } else {
                    console.log('Recieved errors, could not split')
                  }
                });
              };
              return outputFile(`./files/${partName}`);
            })
          }
        // })
      }, 1000)
    });

    fstream.on('error', err => {
      console.log(`Cancelled ${info.filename}: ${err.message}`)
      clearInterval(checkCancel);
      file.unpipe(fstream);
      fstream.destroy()
      fs.unlink(__dirname + '/files/' + info.filename, err => {
        if (err) console.log(err);
      })
    })
  });

  const maxSize = 1024 * 1024 * 25; // 25 MB

  req.busboy.on('finish', () => {
    res.sendStatus(200);
  })
})

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
})

client.on('messageCreate', msg => {
  if (msg.content == '!ping') return msg.reply('pong');
})

app.listen(port, () => {
  console.log('Listening on ' + port)
})

mongoose.set("strictQuery", true);
mongoose
  .connect(process.env.MONGODB)
  .then(() => {
    console.log("Connected to the Database");
  })
  .catch((err) => {
    console.log(err);
  });

client.login(process.env.TOKEN);