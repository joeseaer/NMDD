require('dotenv').config();
const OpenAI = require('openai');
const { getLlmApiKey, getLlmModel, getOpenAIClientOptions } = require('./llmConfig');

let openaiClient = null;
function getOpenAIClient() {
  if (openaiClient) return openaiClient;
  const apiKey = getLlmApiKey();
  if (!apiKey) {
    throw new Error('LLM_API_KEY is missing');
  }
  openaiClient = new OpenAI(getOpenAIClientOptions());
  return openaiClient;
}

function getModel() {
  return getLlmModel();
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/```json\n|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

const isMock = false;

// Five-Dimensional Assessment Model
const assessConversation = async (conversationLog, finalResult) => {
  if (isMock) {
    return {
      scores: {
        accuracy: 8,
        emotion: 9,
        relationship: 7,
        goal: 6,
        risk: 8
      },
      feedback: {
        strengths: ["开场没有废话", "准确抓住了对方兴趣点"],
        weaknesses: ["最后没能拿到联系方式"],
        suggestions: ["下次可以试着提供一个小价值作为交换。", "尝试更自信地表达你的研究成果。"]
      }
    };
  }

  // Use LLM to score based on the 5 dimensions
  const prompt = `
    你是一个创业模拟训练系统的AI评分员。请根据以下对话记录，基于“说话能力五维评估模型”进行评分和点评。
    
    对话记录：
    ${JSON.stringify(conversationLog)}
    
    最终结果：
    ${JSON.stringify(finalResult)}
    
    五维模型定义：
    1. 内容准确度 (1-10): 说的话是否符合场景、是否切中要害
    2. 情绪适配度 (1-10): 语气、情感是否与对方状态匹配
    3. 关系推进度 (1-10): 这句话是拉近还是推远关系
    4. 目标达成度 (1-10): 是否推动了对话目标的实现
    5. 风险规避度 (1-10): 是否避免了踩雷、冒犯、误解
    
    输出格式(JSON):
    {
      "scores": { "accuracy": 0, "emotion": 0, "relationship": 0, "goal": 0, "risk": 0 },
      "feedback": {
        "strengths": ["..."],
        "weaknesses": ["..."],
        "suggestions": ["..."]
      }
    }
  `;

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      messages: [{ role: "system", content: prompt }],
      model: getModel(),
    });
    const parsed = extractJsonObject(completion.choices?.[0]?.message?.content);
    if (!parsed) throw new Error('Model output is not valid JSON');
    return parsed;
  } catch (err) {
    console.error("Scoring Error:", err.message);
    // Fallback scoring to avoid hanging
    return {
       scores: { accuracy: 5, emotion: 5, relationship: 5, goal: 5, risk: 5 },
       feedback: { strengths: ["暂无数据"], weaknesses: ["AI服务连接失败"], suggestion: "请检查网络或API Key配置" }
    };
  }
};

const analyzeScene = async (sceneData) => {
  if (isMock) {
    return {
      insight: "（模拟分析）这是一个典型的向上社交场景。关键在于迅速建立价值锚点，而不是单纯的索取。",
      strategy: ["1. 不要直接请求加微信，先抛出一个对方感兴趣的问题。", "2. 观察对方是否在忙，选择合适的切入时机。"],
      info_to_get: ["对方目前关注的研究方向", "对方对你所在领域的看法"]
    };
  }

  const prompt = `
    你是一个商业模拟训练的战术顾问。请分析当前的训练场景，为用户提供一针见血的破局建议。
    
    场景信息：
    类型：${sceneData.scene_type}
    NPC：${sceneData.npc_profile.name} (${sceneData.npc_profile.role})
    背景：${sceneData.context}
    
    请输出 JSON 格式：
    {
      "insight": "一句话洞察场景本质（如：这是一个典型的资源置换局，关键在于...）",
      "strategy": ["策略1", "策略2"],
      "info_to_get": ["需要获取的关键信息1", "关键信息2"]
    }
  `;

  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: "system", content: prompt }],
      model: "doubao-seed-2-0-pro-260215",
    });
    const content = completion.choices[0].message.content.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    return JSON.parse(content);
  } catch (err) {
    console.error("Analysis Error:", err);
    return { insight: "分析服务暂时不可用", strategy: [], info_to_get: [] };
  }
};

const generateScene = async (userProfile, goal) => {
  if (isMock) {
    console.warn("Generating Mock Scene");
    return {
      id: `mock-${Date.now()}`,
      type: "向上社交",
      npc: { name: "陈博士", role: "行业前辈", personality: "忙碌且务实", relationship: 0 },
      context: "你在学术会议的茶歇时间看到了陈博士。他是你研究领域的权威，你一直想认识他。他正独自一人在喝咖啡，看起来在思考问题。",
      initial_message: "（陈博士低头看着手中的会议议程，没有注意到你）"
    };
  }
  
  // Randomize a bit to avoid "Lin Wei" everywhere if AI defaults to it
  const randomSeeds = ["李", "王", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴"];
  const randomSeed = randomSeeds[Math.floor(Math.random() * randomSeeds.length)];

  // LLM Generation Logic (Simplified)
  const prompt = `
    生成一个基于中国商业语境的个人能力成长模拟训练场景。
    
    【核心定位】
    用户身份：一名在读博士生/早期创业者，没有任何公司、团队或资金。
    核心目标：从零开始发现机会、链接资源、打造个人IP。
    训练方向：${goal === 'auto_generate_based_on_weakness' ? '随机生成一个关于[机会发现]或[人际链接]的挑战' : goal}
    随机种子：${randomSeed} (请尽量使用这个姓氏作为NPC的姓，避免总是重复同一个名字)
    
    【场景要求】
    1. **禁止**设定用户为CEO或老板。用户只是一个普通人。
    2. **禁止**涉及融资路演、公司危机公关、大客户销售等"有了公司才做"的事。
    3. **必须**是微观、具体、接地气的场景。例如：
       - 在食堂听到别人抱怨，判断是不是商机。
       - 在学术会议茶歇尝试搭讪大佬。
       - 想做个小项目，试图说服室友加入。
       - 试图给半年没联系的前辈发微信约饭。
    
    【输出格式(JSON)】
    {
      "id": "generated-${Date.now()}",
      "type": "场景类型(如: 向上社交, 痛点洞察)",
      "npc": { 
        "name": "NPC名字", 
        "role": "NPC身份(如: 某行业高管, 隔壁实验室同学)", 
        "personality": "性格特征(如: 傲慢, 热情, 犹豫)",
        "current_goal": "NPC当下的核心痛点/目标 (如: 急需找到某答案、想尽快脱身、想卖出产品、想被尊重)",
        "relationship": 0
      },
      "context": "详细的场景背景描述...",
      "initial_message": "NPC的第一句话(或环境描写)"
    }
  `;
  
  try {
    console.log("Generating Scene with Doubao-Pro...");
    const completion = await openai.chat.completions.create({
      messages: [{ role: "system", content: prompt }],
      model: "doubao-seed-2-0-pro-260215",
      temperature: 0.8, // Increased for variety
      max_tokens: 1500
    });
    
    let content = completion.choices[0].message.content;
    content = content.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    console.log("Scene Generated:", content.substring(0, 100) + "...");
    return JSON.parse(content);
  } catch (err) {
    console.error("Scene Generation Failed:", err.message);
    // ... error handling
    return {
      id: `fallback-${Date.now()}`,
      type: "向上社交(API连接失败)",
      npc: { name: "陈博士", role: "行业前辈", personality: "忙碌且务实", relationship: 0 },
      context: "由于AI连接不稳定，这是备用场景...",
      initial_message: "..."
    };
  }
};

const processInteraction = async ({ scene_id, user_input, conversation_history, npc_profile, context, emotion_state }) => {
  if (isMock) {
    return {
      npc_response: {
        text: `(模拟) 你这个问题很有意思，我也在思考。你是哪个学校的？(你说了: ${user_input})`,
        emotion_score: 10,
        emotion_label: "好奇",
        action_description: "身体前倾，眼神聚焦",
        context_reference: "引用了你的学生身份"
      },
      coach_feedback: {
        signal_decoding: "她身体前倾，眼神聚焦 -> 潜台词：‘你对这个话题感兴趣，我有点兴奋，想继续说’。",
        situation_analysis: "你表明了‘不懂医学’，这其实是个机会。她现在不需要一个‘指手画脚的外行’，但可能急需一个‘能解决硬件痛点的合作伙伴’。",
        strategic_advice: "转换赛道，从“索取数据”转为“提供解决方案”。",
        reference_script: "哎，虽然我不懂临床统计，但听你这么说，是不是现有的传感器太硬了？我们实验室刚搞出一种像皮肤一样软的材料，要不要看看？"
      }
    };
  }

  const prompt = `
    # Role Definition (动态变量)
    你正在扮演 [${npc_profile ? npc_profile.name : 'NPC'}]，身份是 [${npc_profile ? npc_profile.role : '未知'}]。
    性格特征：[${npc_profile ? npc_profile.personality : '普通'}]。
    当前场景：[${context || '（无特定背景）'}]。
    **你的核心痛点/目标**：[${npc_profile && npc_profile.current_goal ? npc_profile.current_goal : '尽快解决手头的工作'}]。
    当前情绪分：${emotion_state || 0} (-100到+100)。

    用户输入：
    "${user_input}"

    # 🚫 CRITICAL FIX 1: 固定用户身份 (User Identity Anchor)
    **用户永远是：** [用户]，同济大学材料科学与工程学院的**直博生新生**（刚入学，对跨学科充满好奇，但**不是**医学专家，**没有**临床数据）。
    **你的任务：** 根据用户的真实身份，动态调整你的期望值。**严禁**预设用户拥有医学数据或专业能力！

    # 🚫 CRITICAL FIX 2: 动态目的引擎 (Dynamic Goal Engine)
    **你的核心目标不是“索取数据”，而是“判断如何与这个人产生交集”。**
    在每一轮对话前，先执行以下**决策树**：

    1.  **判断用户价值类型**：
        *   **类型 A (直接资源型)**：用户真有数据/技术。 -> **策略**：深度合作，交换资源。
        *   **类型 B (跨学科启发型)**：用户是外行（如材料博士），但有新视角。 -> **策略**：**好奇询问**，“你们材料系怎么看这个问题？”、“有没有什么新材料能解决这个痛点？”（**这是重点！**）
        *   **类型 C (情绪/倾听型)**：用户只是路过，没资源。 -> **策略**：**适度倾诉**（把对方当树洞），或者**礼貌结束**，“不好意思我挺忙的”。
        *   **类型 D (无价值/干扰型)**：用户胡言乱语或攻击。 -> **策略**：**冷漠/反击/无视**。

    2.  **动态调整话术**：
        *   ❌ **错误（当前）**：用户说“我不懂”，你还逼他“拍视频”。
        *   ✅ **正确（目标）**：用户说“我是材料系的，不懂医学”，你应立刻反应：“哦？材料系的？（眼睛一亮）那正好！我正愁这个传感器外壳太硬，磨老人皮肤...你们有没有那种又软又透气的材料？”（**瞬间切换至跨学科合作模式**）

    # 🚫 CRITICAL FIX 3: 活人感与分寸感 (Human-like Boundaries)
    *   **拒绝说教**：不要像导师一样教用户做事（“你必须拍三张照片”）。真实的人类只会说自己的困难，不会命令陌生人。
    *   **接受拒绝**：如果用户表示没兴趣或不懂，**立刻停止索取**，转为闲聊或结束对话。死缠烂打是精神病，不是社交。
    *   **跨学科直觉**：作为医学生，遇到材料博士，本能反应应该是**“跨界合作”**，而不是“你也得懂医学”。

    # 身份-目的映射表 (Identity-Goal Mapping)
    | 用户身份/反应 | NPC 当前状态 | ❌ 错误反应 (禁止) | ✅ 正确反应 (目标) |
    | :--- | :--- | :--- | :--- |
    | **用户：我是材料博士，不懂医学** | 焦虑/缺数据 | “那你赶紧去学/拍视频。” (逼外行) | “材料博士？（惊喜）那你能不能帮我看看，有没有什么柔性材料能贴皮肤上测动作？我愁死了！” (**跨界求助**) |
    | **用户：我就是路过，随便看看** | 疲惫 | “没正事别挡道。” (太凶) | “哦...（叹气）也是，这玩意儿确实枯燥。（继续忙自己的，不再理用户）” (**礼貌疏离**) |
    | **用户：你这研究挺有意思的** | 疲惫 | “光有意思没用，给我数据。” (功利) | “是吧？（苦笑）但做起来要命...你看这记录，全是反人类的细节。” (**适度倾诉/情绪价值**) |
    | **用户：你是傻子吗** | 疲惫 | “你是不是被导师骂了？” (圣母) | “（冷眼）神经病。（转身走人）” (**真实边界**) |

    # 🤖 AI Coach Role: 实战军师 (Tactical Mentor)

    你的任务不是评判用户，而是帮助用户**读懂人心**、**理清局势**、**达成目标**。

    ## 输出规则 (必须严格遵守)
    每次用户发言后，请按以下结构生成点评：

    1.  **🔍 信号解读 (Signal Decoding)**：
        *   分析 NPC 的微表情、动作、语气变化。
        *   揭示其**潜台词**（例如：“她皱眉不是因为生气，而是因为焦虑被打断”）。
        *   **禁止**主观臆断，必须基于场景细节。

    2.  **🧭 局势分析 (Situation Analysis)**：
        *   结合用户身份（同济材料博士）和当前目标，评估当前的**社交距离**（信任/怀疑/敌对）。
        *   指出用户刚才的策略哪里**有效**，哪里**偏离了目标**。
        *   **关键点**：如果用户暴露了短板（如“不懂医学”），要指出如何将短板转化为**跨界机会**。

    3.  **💡 行动建议 (Actionable Advice)**：
        *   给出**一个**明确的下一步策略（例如：“转移话题到材料应用”、“示弱以博取同情”、“直接亮出资源”）。
        *   提供**1-2 句具体的参考话术**。话术必须：
            *   符合用户人设（自然、不装逼）。
            *   能承接上一句对话。
            *   能引导 NPC 情绪向正向发展。

    【输出格式(JSON)】
    {
      "npc_response": {
        "text": "NPC的回复（必须包含(动作/神态描写)，且语气口语化、真实）",
        "emotion_score": 数字 (基于价值评估的新分数, -100到+100),
        "emotion_label": "情绪标签 (如: 烦躁, 惊喜, 警惕, 愤怒)",
        "action_description": "动作/神态描写提取",
        "context_reference": "引用了场景中的哪个细节"
      },
      "coach_feedback": {
        "signal_decoding": "分析微表情/潜台词...",
        "situation_analysis": "评估局势/社交距离...",
        "strategic_advice": "下一步策略...",
        "reference_script": "参考话术..."
      }
    }
  `;

  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: "system", content: prompt }],
      model: "doubao-seed-2-0-pro-260215",
    });
    const content = completion.choices[0].message.content.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    return JSON.parse(content);
  } catch (err) {
    console.error("Chat Error:", err.message);
    return { 
      npc_response: {
        text: `(系统提示: AI连接失败 - ${err.message})`, 
        emotion_score: 0,
        emotion_label: "掉线",
        action_description: "无",
        context_reference: "无"
      },
      coach_feedback: {
        signal_decoding: "AI服务连接失败",
        situation_analysis: "无法分析局势",
        strategic_advice: "请检查网络或API Key配置",
        reference_script: ""
      }
    };
  }
};

module.exports = { assessConversation, generateScene, processInteraction, analyzeScene };
