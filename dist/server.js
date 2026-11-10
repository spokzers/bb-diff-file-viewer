import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
var __filename = __fileURLToPath(import.meta.url);
var __dirname = __pathDirname(__filename);
var t=Object.defineProperty;var i=(e,l)=>t(e,"name",{value:l,configurable:!0});async function n(e){e.log.info("loaded"),e.settings.define({sidebarPosition:{type:"select",label:"File sidebar position",options:["left","right"],experimental_optionLabels:{left:"Left",right:"Right"},default:"left"},fileView:{type:"select",label:"Default file view",options:["single","multiple"],experimental_optionLabels:{single:"One file at a time",multiple:"Multiple files"},default:"single"},fileNavigation:{type:"select",label:"Default file navigation",options:["tree","list"],experimental_optionLabels:{tree:"Folder tree",list:"Flat list"},default:"tree"},diffView:{type:"select",label:"Default diff layout",options:["unified","split"],experimental_optionLabels:{unified:"Unified",split:"Side by side"},default:"unified"}}),e.onDispose(()=>e.log.info("disposed"))}i(n,"plugin");export{n as default};
//# sourceMappingURL=server.js.map
