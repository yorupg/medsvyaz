import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {serveStatic} from '@hono/node-server/serve-static';
import {createApi} from './api';
import {createStore} from './store';
import {createServer} from 'node:http';
import {getRequestListener} from '@hono/node-server';
const arg=(flag:string)=>{const i=process.argv.indexOf(flag);return i>=0?process.argv[i+1]:undefined;};
const port=Number(arg('--port')??process.env.PORT??5180),host=arg('--host')??process.env.HOST??'0.0.0.0';
const app=new Hono();
app.route('/api',createApi(createStore()));
if(process.argv.includes('--production')){
 app.use('*',async(c,next)=>{if(!c.req.path.startsWith('/assets/')&&!c.req.path.startsWith('/api/'))c.header('Cache-Control','no-store');await next();});
 app.use('*',serveStatic({root:'./dist/client'}));app.get('*',serveStatic({path:'./dist/client/index.html'}));
 serve({fetch:app.fetch,port,hostname:host},()=>console.log(`МедСвязь 24/7: http://${host}:${port}`));
} else {
 const {createServer:createVite}=await import('vite');
 const vite=await createVite({server:{middlewareMode:true},appType:'spa'});
 const handler=getRequestListener(app.fetch);
 const server=createServer((req,res)=>{if(req.url?.startsWith('/api/'))void handler(req,res);else vite.middlewares(req,res);});
 server.listen(port,host,()=>console.log(`МедСвязь 24/7: http://${host}:${port}`));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void vite.close();server.close();process.exit(0);});
}
