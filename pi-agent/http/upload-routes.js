import {saveIncomingImage,listUploads,uploadFile,renameUpload,deleteUpload} from '../lib/uploads.js';
import {HttpError} from '../../shared/errors.js';

export function registerUploadRoutes(app) {
  const listing=(req,res)=>{
    const offset=Number(req.query.offset || req.body?.offset || 0);
    if(!Number.isSafeInteger(offset)||offset<0)throw new HttpError(400,'Ungültige Seite');
    res.json(listUploads(req.userId,offset));
  };
  app.get('/uploads',listing);
  app.post('/uploads/list',listing);
  app.post('/uploads',(req,res)=>{
    const {image_base64:image,name}=req.body || {};
    if(typeof image!=='string'||image.length>14*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))throw new HttpError(400,'Ungültiges Bild');
    if(name!==undefined && (typeof name!=='string'||name.length>130))throw new HttpError(400,'Ungültiger Bildname');
    const saved=saveIncomingImage(req.userId,image,{name});
    res.status(201).json({name:saved.name,relative:saved.relative});
  });
  app.get('/uploads/:name/content',(req,res)=>res.sendFile(uploadFile(req.userId,req.params.name)));
  app.patch('/uploads/:name',(req,res)=>res.json(renameUpload(req.userId,req.params.name,req.body?.name)));
  app.delete('/uploads/:name',(req,res)=>res.json(deleteUpload(req.userId,req.params.name)));
}
