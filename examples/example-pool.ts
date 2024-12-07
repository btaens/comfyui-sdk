import { ComfyApi } from "../src/client";
import { CallWrapper } from "../src/call-wrapper";
import { ComfyPool, EQueueMode } from "../src/pool";
import { PromptBuilder } from "../src/prompt-builder";
import ExampleTxt2ImgWorkflow from "./example-txt2img-workflow.json";
import { TSamplerName, TSchedulerName } from "../src/types/sampler";
import { seed } from "../src/tools";

/**
 * Define a T2I (text to image) workflow task
 */
export const Txt2ImgPrompt = new PromptBuilder(
  ExampleTxt2ImgWorkflow, // Get from `Save (API Format)` button in ComfyUI's website
  [
    "positive",
    "negative",
    "checkpoint",
    "seed",
    "batch",
    "step",
    "cfg",
    "sampler",
    "sheduler",
    "width",
    "height",
    "sampler",
    "scheduler"
  ],
  ["images"]
)
  .setInputNode("checkpoint", "4.inputs.ckpt_name")
  .setInputNode("seed", "3.inputs.seed")
  .setInputNode("batch", "5.inputs.batch_size")
  .setInputNode("negative", "7.inputs.text")
  .setInputNode("positive", "6.inputs.text")
  .setInputNode("step", "3.inputs.steps")
  .setInputNode("width", "5.inputs.width")
  .setInputNode("height", "5.inputs.height")
  .setInputNode("cfg", "3.inputs.cfg")
  .setInputNode("sampler", "3.inputs.sampler_name")
  .setInputNode("scheduler", "3.inputs.scheduler")
  .setOutputNode("images", "9");

/**
 * Define a pool of ComfyApi
 */
const ApiPool = new ComfyPool(
  [
    new ComfyApi("http://localhost:8188"), // Comfy Instance 1
    new ComfyApi("http://localhost:8189") // Comfy Instance 2
  ],
  EQueueMode.PICK_ZERO
)
  .on("init", () => console.log("Pool in initializing"))
  .on("loading_client", (ev) => console.log("Loading client", ev.detail.clientIdx))
  .on("add_job", (ev) => console.log("Job added at index", ev.detail.jobIdx, "weight:", ev.detail.weight))
  .on("added", (ev) => console.log("Client added", ev.detail.clientIdx));

/**
 * Define the generator function for all nodes
 */
const generateFn = async (api: ComfyApi, clientIdx?: number) => {
  return new Promise<string[]>((resolve) => {
    /**
     * Set the workflow's input values
     */
    const workflow = Txt2ImgPrompt.input(
      "checkpoint",
      "SDXL/realvisxlV40_v40LightningBakedvae.safetensors",
      /**
       * Use the client's osType to encode the path
       */
      api.osType
    )
      .input("seed", seed())
      .input("step", 6)
      .input("width", 512)
      .input("height", 512)
      .input("batch", 2)
      .input("cfg", 1)
      .input<TSamplerName>("sampler", "dpmpp_2m_sde_gpu")
      .input<TSchedulerName>("scheduler", "sgm_uniform")
      .input("positive", "A close up picture of cute Cat")
      .input("negative", "text, blurry, bad picture, nsfw");

    new CallWrapper(api, workflow)
      .onPending((promptId) =>
        console.log(`[${clientIdx}]`, `#${promptId}`, "Task is pending", {
          clientId: api.id,
          clientOs: api.osType
        })
      )
      .onStart((promptId) => console.log(`[${clientIdx}]`, `#${promptId}`, "Task is started"))
      .onPreview((blob, promptId) => console.log(`[${clientIdx}]`, `#${promptId}`, "Blob size", blob.size))
      .onFinished((data, promptId) => {
        console.log(`[${clientIdx}]`, `#${promptId}`, "Task is finished");
        const url = data.images?.images.map((img: any) => api.getPathImage(img));
        resolve(url as string[]);
      })
      .onProgress((info, promptId) => {
        console.log(`[${clientIdx}]`, `#${promptId}`, "Processing node", info.node, `${info.value}/${info.max}`);
      })
      .onFailed((err, promptId) => {
        console.log(`[${clientIdx}]`, `#${promptId}`, "Task is failed", err);
        resolve([]);
      })
      .run();
  });
};
/**
 * Single shoot
 */
// const output = ApiPool.run(generateFn);

/**
 * Multiple shoot using batch
 */
const jobA = ApiPool.batch(
  Array(5)
    .fill("")
    .map(() => generateFn),
  10 // weight = 10, more weight = lower priority
).then((res) => {
  console.log("Batch A done");
  return res.flat();
});

const jobB = ApiPool.batch(
  Array(5)
    .fill("")
    .map(() => generateFn),
  0 // weight = 0, should be executed first
).then((res) => {
  console.log("Batch B done");
  return res.flat();
});

console.log(await Promise.all([jobA, jobB]).then((res) => res.flat()));
