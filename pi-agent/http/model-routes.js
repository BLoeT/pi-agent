export function registerModelRoutes(app,{chat}) {
  app.get("/models",async(req,res)=>res.json(await chat.listModels(req.userId,false)));
  // Internal clients supply their authenticated user mapping in JSON, never in a URL.
  app.post("/models/list",async(req,res)=>{
    const refresh=req.body?.refresh ?? false;
    if(typeof refresh!=="boolean")return res.status(400).json({error:"Ungültiger Aktualisierungswert"});
    res.json(await chat.listModels(req.userId,refresh));
  });
  app.post("/model",async(req,res)=>res.json(await chat.setModel(req.userId,req.body?.model)));
}
