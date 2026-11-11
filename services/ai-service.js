
require('dotenv').config();

const db = require('./db');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_RECOMMENDATIONS = 5;

function getGeminiConfig() {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL)
        .trim()
        .replace(/^models\//, '');

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY chưa được cấu hình.');
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
        throw new Error('GEMINI_MODEL không đúng định dạng.');
    }

    return { apiKey, model };
}

function extractJson(text) {
    if (!text) {
        throw new Error('Gemini không trả về nội dung.');
    }

    let content = text.trim();

    // Loại bỏ Markdown code fence nếu AI vô tình trả về
    content = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

    try {
        return JSON.parse(content);
    } catch {
        throw new Error('Gemini trả về dữ liệu JSON không hợp lệ.');
    }
}

async function getProducts() {
    const [products] = await db.query(`
        SELECT
            p.id,
            p.name,
            p.code,
            p.price,
            p.category_id,
            p.brand_id,
            c.name AS categoryName,
            br.name AS brandName,
            COALESCE(s.stock, 0) AS stock
        FROM products p

        LEFT JOIN (
            SELECT
                product_id,
                SUM(
                    CASE
                        WHEN expiry_date >= CAST(GETDATE() AS date)
                        THEN quantity
                        ELSE 0
                    END
                ) AS stock
            FROM inventory_batches
            GROUP BY product_id
        ) s ON s.product_id = p.id

        LEFT JOIN categories c
            ON c.id = p.category_id

        LEFT JOIN brands br
            ON br.id = p.brand_id

        ORDER BY p.name
        OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY
    `);

    return products || [];
}

async function callGemini({ apiKey, model, prompt }) {
    const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(endpoint, {
        method: 'POST',

        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },

        body: JSON.stringify({
            systemInstruction: {
                parts: [{
                    text: `
Bạn là trợ lý tư vấn mỹ phẩm chuyên nghiệp.

Bạn phải:
- Chỉ sử dụng thông tin có trong danh sách sản phẩm.
- Không tự tạo sản phẩm, giá tiền hoặc số lượng tồn kho.
- Không gợi ý sản phẩm không còn hàng.
- Không chẩn đoán bệnh da liễu.
- Trả lời bằng tiếng Việt.
- Giải thích lý do gợi ý sản phẩm.
- Đưa ra hướng dẫn sử dụng an toàn.
- Nếu không có sản phẩm phù hợp, hãy nói rõ.
- Chỉ trả về JSON hợp lệ theo yêu cầu.
                    `.trim()
                }]
            },

            contents: [{
                role: 'user',
                parts: [{
                    text: prompt
                }]
            }],

            generationConfig: {
                responseMimeType: 'application/json',
                maxOutputTokens: 4096
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        const apiMessage =
            data.error?.message || 'Không thể kết nối Gemini API.';

        throw new Error(
            `Gemini API (${response.status}): ${apiMessage}`
        );
    }

    const candidate = data.candidates?.[0];

    if (!candidate) {
        throw new Error(
            'Gemini không trả về kết quả. Có thể yêu cầu đã bị chặn.'
        );
    }

    if (candidate.finishReason === 'SAFETY') {
        throw new Error(
            'Yêu cầu tư vấn bị hệ thống an toàn của Gemini chặn.'
        );
    }

    const content = candidate.content?.parts
        ?.map(part => part.text || '')
        .join('');

    return extractJson(content);
}

async function recommend({
    message,
    budget,
    skinType,
    concerns,
    category
}) {
    // 1. Kiểm tra đầu vào
    if (
        typeof message !== 'string' ||
        !message.trim() ||
        message.length > MAX_MESSAGE_LENGTH
    ) {
        throw new Error(
            'Vui lòng nhập nhu cầu tư vấn (tối đa 2000 ký tự).'
        );
    }

    // 2. Kiểm tra cấu hình Gemini
    const { apiKey, model } = getGeminiConfig();

    // 3. Lấy dữ liệu sản phẩm từ SQL Server
    const products = await getProducts();

    // 4. Chỉ lấy sản phẩm còn hàng
    const available = products.filter(
        product => Number(product.stock) > 0
    );

    const catalog = available.map(product => ({
        id: product.id,
        name: product.name,
        code: product.code,
        price: Number(product.price),
        stock: Number(product.stock),
        category: product.categoryName || null,
        brand: product.brandName || null
    }));

    // 5. Kiểm tra danh mục sản phẩm
    if (catalog.length === 0) {
        return {
            answer: 'Hiện tại cửa hàng chưa có sản phẩm nào còn hàng để tư vấn. Bạn vui lòng quay lại sau nhé!',
            recommendations: [],
            model
        };
    }

    // 6. Tạo nội dung yêu cầu AI
    const customerInfo = {
        budget: budget || null,
        skinType: skinType || null,
        concerns: concerns || null,
        category: category || null,
        message: message.trim()
    };

    const prompt = `
Hãy tư vấn mỹ phẩm cho khách hàng dựa trên thông tin dưới đây.

THÔNG TIN KHÁCH HÀNG:
${JSON.stringify(customerInfo, null, 2)}

DANH SÁCH SẢN PHẨM CỬA HÀNG:
${JSON.stringify(catalog, null, 2)}

YÊU CẦU:
1. Phân tích nhu cầu khách hàng.
2. Chọn tối đa 5 sản phẩm phù hợp nhất.
3. Chỉ sử dụng productId có trong danh sách.
4. Không được tự bịa tên sản phẩm hoặc giá.
5. Ưu tiên sản phẩm phù hợp ngân sách và loại da.
6. Nếu không có sản phẩm phù hợp, trả về recommendations rỗng.
7. Viết câu trả lời bằng tiếng Việt, thân thiện và dễ hiểu.
8. Mỗi sản phẩm cần có lý do gợi ý cụ thể.

ĐỊNH DẠNG KẾT QUẢ:
{
  "answer": "Nội dung tư vấn cho khách hàng",
  "recommendations": [
    {
      "productId": 1,
      "reason": "Lý do lựa chọn sản phẩm"
    }
  ]
}

Chỉ trả về JSON, không thêm Markdown hoặc nội dung bên ngoài JSON.
`;

    // 7. Gọi Gemini
    const parsed = await callGemini({
        apiKey,
        model,
        prompt
    });

    // 8. Kiểm tra kết quả AI với dữ liệu thật
    const allowed = new Map(
        catalog.map(product => [
            Number(product.id),
            product
        ])
    );

    const recommendations = (
        Array.isArray(parsed.recommendations)
            ? parsed.recommendations
            : []
    )
        .filter(item => {
            return allowed.has(Number(item.productId));
        })
        .slice(0, MAX_RECOMMENDATIONS)
        .map(item => ({
            ...allowed.get(Number(item.productId)),
            reason: String(item.reason || '').slice(0, 500)
        }));

    // 9. Trả kết quả cho hệ thống
    return {
        answer: String(
            parsed.answer ||
            'Mình chưa tìm được gợi ý phù hợp.'
        ).slice(0, 5000),

        recommendations,

        model
    };
}

module.exports = {
    recommend
};
