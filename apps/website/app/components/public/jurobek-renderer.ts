/** True volumetric JURO character: closed ellipsoid meshes, articulated head and
 * arm groups, physical normals and three-point shader lighting. No image planes. */
export function createJurobekRenderer(canvas:HTMLCanvasElement,ready:()=>void,failed:()=>void){
 const gl=canvas.getContext("webgl",{alpha:true,antialias:true,powerPreference:"low-power"});if(!gl){failed();return null;}
 const shaders:WebGLShader[]=[];
 const compile=(type:number,source:string)=>{const s=gl.createShader(type)!;shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||"Shader error");return s;};
 const program=gl.createProgram()!;
 try{
 gl.attachShader(program,compile(gl.VERTEX_SHADER,`precision mediump float;attribute vec3 point;uniform vec3 center,size;uniform vec2 turn;uniform float angle,head,clock,aspect,blink;varying vec3 normal,pos;
 mat3 yaw(float a){return mat3(cos(a),0.,-sin(a),0.,1.,0.,sin(a),0.,cos(a));}
 mat3 roll(float a){return mat3(cos(a),sin(a),0.,-sin(a),cos(a),0.,0.,0.,1.);}
 void main(){vec3 scale=size;scale.y*=blink;mat3 local=roll(angle);vec3 p=local*(point*scale)+center;vec3 n=local*normalize(point/scale);
 if(head>.5){mat3 h=yaw(turn.x*.65+sin(clock*.48)*.035)*roll(turn.y*.25);p=h*(p-vec3(0.,.65,0.))+vec3(0.,.65,0.);n=h*n;}
 if(head<-.5){mat3 a=roll(sin(clock*.85)*.06+turn.y*.15);p=a*(p-vec3(.62,-.55,0.))+vec3(.62,-.55,0.);n=a*n;}
 mat3 world=yaw(turn.x*.45-.08);p=world*p;n=world*n;p.y+=sin(clock*.7)*.012;normal=n;pos=p;float z=4.8-p.z;gl_Position=vec4(p.x*2.8/aspect,(p.y+.02)*2.8,z-2.,z);}`));
 gl.attachShader(program,compile(gl.FRAGMENT_SHADER,`precision mediump float;uniform vec3 color;uniform float gloss;varying vec3 normal,pos;void main(){vec3 n=normalize(normal);vec3 l=normalize(vec3(-.6,1.,1.6));float diffuse=max(dot(n,l),0.);float rim=pow(1.-max(dot(n,vec3(0.,0.,1.)),0.),3.);float shine=pow(max(dot(n,normalize(l+normalize(vec3(0.,0.,4.8)-pos))),0.),32.);vec3 c=color*(.43+.63*diffuse)+vec3(.18,.30,.38)*rim+vec3(1.,.88,.67)*shine*gloss;gl_FragColor=vec4(pow(c,vec3(.88)),1.);}`));
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||"Link error");
 }catch(error){canvas.dataset.rendererError=String(error);shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);failed();return null;}
 gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
 const vertices:number[]=[];const point=(u:number,v:number)=>[Math.sin(v)*Math.cos(u),Math.cos(v),Math.sin(v)*Math.sin(u)];
 for(let j=0;j<20;j++)for(let i=0;i<32;i++){const a=point(i*Math.PI/16,j*Math.PI/20),b=point((i+1)*Math.PI/16,j*Math.PI/20),c=point(i*Math.PI/16,(j+1)*Math.PI/20),d=point((i+1)*Math.PI/16,(j+1)*Math.PI/20);vertices.push(...a,...b,...c,...c,...b,...d);}
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,"point");gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,3,gl.FLOAT,false,0,0);
 const uniforms=Object.fromEntries(["center","size","turn","angle","head","clock","aspect","blink","color","gloss"].map(k=>[k,gl.getUniformLocation(program,k)]));
 type Vec=[number,number,number];type Part={center:Vec;size:Vec;color:Vec;angle:number;head:number;eye:boolean;gloss:number};const parts:Part[]=[];
 const skin:Vec=[.84,.53,.32],navy:Vec=[.045,.13,.20],hair:Vec=[.045,.027,.021],gold:Vec=[.75,.57,.28],ivory:Vec=[.89,.85,.74];
 const add=(center:Vec,size:Vec,color:Vec,head=0,angle=0,eye=false,gloss=.08)=>parts.push({center,size,color,head,angle,eye,gloss});
 // Tailored silhouette, neck, shirt and a small gold lapel pin.
 add([0,-1.26,0],[.69,.09,.41],navy,0,0,false,.3);add([0,-.57,0],[.59,.68,.32],navy);
 add([0,-.27,.305],[.16,.27,.035],ivory);add([0,.015,0],[.20,.25,.20],skin);
 add([-.20,-.28,.30],[.075,.32,.045],navy,0,-.32);add([.20,-.28,.30],[.075,.32,.045],navy,0,.32);add([-.31,-.25,.29],[.035,.048,.02],gold,0,0,false,.4);
 add([-.59,-.63,0],[.16,.43,.19],navy,0,-.16);add([-.65,-.98,.08],[.125,.17,.12],skin);
 add([.61,-.54,0],[.16,.39,.19],navy,-1,.22);add([.77,-.19,.12],[.13,.30,.15],navy,-1,-.35);add([.86,.085,.16],[.12,.16,.095],skin,-1,-.15);
 for(let i=0;i<4;i++)add([.79+i*.046,.25+Math.sin(i*.9)*.025,.15],[.026,.105,.028],skin,-1,-.12);
 add([.73,.085,.19],[.07,.033,.035],skin,-1,-.5);
 // Head, ears, hair volume and embroidered doppi keep the brand character recognisable.
 add([0,.66,0],[.49,.61,.405],skin,1);add([-.48,.63,0],[.10,.17,.10],skin,1);add([.48,.63,0],[.10,.17,.10],skin,1);
 add([0,1.075,-.035],[.50,.25,.405],hair,1);add([-.15,1.035,.31],[.30,.09,.11],hair,1,.12);add([.19,1.065,.28],[.22,.11,.10],hair,1,-.18);
 add([0,1.245,-.02],[.52,.135,.42],[.035,.045,.05],1,0,false,.2);add([0,1.155,.0],[.52,.024,.42],ivory,1);
 for(let i=0;i<5;i++){const x=(i-2)*.17,z=.415*Math.sqrt(1-x*x/.28);for(const side of [-1,1]){add([x+side*.018,1.245,z],[.009,.027,.009],ivory,1,side*.5,false,0);add([x+side*.018,1.205,z],[.009,.027,.009],ivory,1,-side*.5,false,0);}}
 // Actual eye meshes, pupils, highlights and independently animated eyelids.
 for(const side of [-1,1]){add([side*.19,.755,.345],[.137,.112,.075],ivory,1,0,true);add([side*.19,.755,.409],[.059,.071,.025],[.18,.08,.03],1,0,true,.4);add([side*.19,.755,.43],[.028,.042,.014],[.009,.014,.016],1,0,true);add([side*.19-.018,.782,.444],[.014,.019,.01],[1,1,1],1,0,true,.5);add([side*.19,.936,.339],[.145,.031,.037],hair,1,side*-.12);}
 add([0,.607,.388],[.072,.116,.10],skin,1);add([0,.547,.438],[.09,.055,.064],skin,1);
 for(let i=0;i<11;i++){const x=(i-5)*.025;add([x,.387+x*x*1.8,.365],[.022,.009,.008],[.30,.105,.064],1,0,false,0);}
 let disposed=false;
 function draw(x:number,y:number,t:number){if(disposed||gl!.isContextLost())return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,1.5),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(!w||!h)return;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl!.viewport(0,0,w,h);gl!.clearColor(0,0,0,0);gl!.clear(gl!.COLOR_BUFFER_BIT|gl!.DEPTH_BUFFER_BIT);gl!.uniform2f(uniforms.turn,x,y);gl!.uniform1f(uniforms.aspect,w/h);gl!.uniform1f(uniforms.clock,t);const blink=Math.max(.08,1-Math.pow(Math.max(0,Math.cos(t*1.3)),80)*.92);
 for(const p of parts){gl!.uniform3fv(uniforms.center,p.center);gl!.uniform3fv(uniforms.size,p.size);gl!.uniform3fv(uniforms.color,p.color);gl!.uniform1f(uniforms.angle,p.angle);gl!.uniform1f(uniforms.head,p.head);gl!.uniform1f(uniforms.blink,p.eye&&t>0?blink:1);gl!.uniform1f(uniforms.gloss,p.gloss);gl!.drawArrays(gl!.TRIANGLES,0,vertices.length/3);}}
 draw(0,0,0);ready();return{draw,dispose(){disposed=true;gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));}};
}
